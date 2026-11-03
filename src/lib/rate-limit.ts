/**
 * Rate limiting and spam defence.
 *
 * Layered cheapest-first, so obvious bots never cost a Turnstile verification:
 *
 *   1. honeypot field      — free, kills naive scripts
 *   2. minimum fill time   — free, kills script-driven submissions
 *   3. per-IP token bucket — one D1 row, stops volumetric abuse
 *   4. Turnstile          — only reached by a submission that passed 1-3
 *
 * Privacy: no raw IP is stored. We keep a truncated, salted, one-way hash,
 * which is enough to rate-limit and cannot be reversed to an address.
 *
 * Route-specific policies are defined in RATE_LIMIT_POLICIES below.
 */

import type { D1Like } from './db';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds?: number;
  limit?: number;
  windowSeconds?: number;
}

export interface RateLimitPolicy {
  /** Unique bucket name for this policy */
  bucket: string;
  /** Maximum requests allowed in the window */
  max: number;
  /** Time window in minutes */
  windowMinutes: number;
  /** Whether to use authenticated identity (for logged-in users) */
  useAuth?: boolean;
  /** Custom identifier extractor (defaults to IP hash) */
  identifierExtractor?: (request: Request, env: { RATE_LIMIT_SALT?: string }) => Promise<string>;
}

/** Route-specific rate limit policies */
export const RATE_LIMIT_POLICIES: Record<string, RateLimitPolicy> = {
  'contact': {
    bucket: 'contact',
    max: 5,
    windowMinutes: 60,
  },
  'admin-login': {
    bucket: 'admin-login',
    max: 5,
    windowMinutes: 60,
  },
  'admin-crud': {
    bucket: 'admin-crud',
    max: 100,
    windowMinutes: 60,
    useAuth: true,
  },
  'api-public': {
    bucket: 'api-public',
    max: 60,
    windowMinutes: 1,
  },
  'cron-dispatch': {
    bucket: 'cron-dispatch',
    max: 10,
    windowMinutes: 10,
    useAuth: true,
  },
  'turnstile': {
    bucket: 'turnstile',
    max: 20,
    windowMinutes: 60,
  },
};

const DEFAULT_POLICY: RateLimitPolicy = {
  bucket: 'default',
  max: 30,
  windowMinutes: 60,
};

/** Get policy for a route, with fallback to default */
export function getPolicy(route: string): RateLimitPolicy {
  // Exact match first
  if (RATE_LIMIT_POLICIES[route]) return RATE_LIMIT_POLICIES[route];
  // Pattern match for dynamic routes
  for (const [pattern, policy] of Object.entries(RATE_LIMIT_POLICIES)) {
    if (pattern.includes('*') || pattern.endsWith('/')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      if (regex.test(route)) return policy;
    }
  }
  return DEFAULT_POLICY;
}

/**
 * Salted, truncated SHA-256. Not reversible to an IP, but stable enough that
 * the same visitor maps to the same bucket within a deploy.
 */
export async function hashIdentifier(ip: string, salt: string): Promise<string> {
  const input = `${salt}:${ip}`;
  const data = new TextEncoder().encode(input);
  // Prefer the platform crypto, which exists in Workers and Node 18+.
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 32);
  }
  // Node fallback for scripts and tests.
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

/** Best-effort client IP. Cloudflare sets CF-Connecting-IP at the edge. */
export function clientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip') ??
    'unknown'
  );
}

/**
 * Extract identifier for rate limiting.
 * For authenticated routes, uses the admin token; for public routes, uses hashed IP.
 */
export async function getRateLimitIdentifier(
  request: Request,
  env: { RATE_LIMIT_SALT?: string; ADMIN_TOKEN?: string },
  policy: RateLimitPolicy
): Promise<string> {
  // For authenticated policies, use the auth token as identifier
  if (policy.useAuth && env.ADMIN_TOKEN) {
    const auth = request.headers.get('authorization');
    if (auth?.startsWith('Bearer ')) {
      const token = auth.slice(7).trim();
      // Hash the token for privacy (same approach as IP)
      return hashIdentifier(token, env.RATE_LIMIT_SALT ?? 'no-salt-configured');
    }
    const cookie = request.headers.get('cookie');
    if (cookie) {
      const match = cookie.match(/studio_admin=([^;]+)/);
      if (match) {
        const token = decodeURIComponent(match[1]).split('.')[0];
        return hashIdentifier(token, env.RATE_LIMIT_SALT ?? 'no-salt-configured');
      }
    }
  }
  // Default: hash the client IP
  const ip = clientIp(request);
  return hashIdentifier(ip, env.RATE_LIMIT_SALT ?? 'no-salt-configured');
}

export async function checkRateLimit(
  db: D1Like,
  identifier: string,
  policy: RateLimitPolicy,
): Promise<RateLimitResult> {
  const windowStart = iso(Date.now() - policy.windowMinutes * 60_000);

  const row = await db
    .prepare('SELECT hits, window_start FROM rate_limits WHERE bucket = ?1 AND identifier = ?2')
    .bind(policy.bucket, identifier)
    .first<{ hits: number; window_start: string }>();

  // Missing row, or the window has rolled over: this is a fresh visitor.
  if (!row || row.window_start < windowStart) {
    return { 
      allowed: true, 
      remaining: policy.max,
      limit: policy.max,
      windowSeconds: policy.windowMinutes * 60,
    };
  }

  if (row.hits >= policy.max) {
    return { 
      allowed: false, 
      remaining: 0, 
      retryAfterSeconds: policy.windowMinutes * 60,
      limit: policy.max,
      windowSeconds: policy.windowMinutes * 60,
    };
  }

  return { 
    allowed: true, 
    remaining: policy.max - row.hits - 1,
    limit: policy.max,
    windowSeconds: policy.windowMinutes * 60,
  };
}

/** SQLite's `datetime('now')` format, which is what the column stores. */
function iso(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

export async function recordAttempt(
  db: D1Like,
  identifier: string,
  policy: RateLimitPolicy,
): Promise<void> {
  const now = iso(Date.now());
  const stale = iso(Date.now() - policy.windowMinutes * 60_000);

  /*
   * The window MUST be re-armed here.
   *
   * The obvious `ON CONFLICT DO UPDATE SET hits = hits + 1` never touches
   * window_start, so once the row aged past the window `checkRateLimit` treated
   * it as a fresh visitor forever and allowed `max` more submissions on every
   * single call — the limiter silently stopped limiting after one hour.
   *
   * `hits = 1` (not `hits + 1`) is the counter reset that re-arms the window.
   */
  await db
    .prepare(
      `INSERT INTO rate_limits (bucket, identifier, hits, window_start)
       VALUES (?1, ?2, 1, ?3)
       ON CONFLICT(bucket, identifier) DO UPDATE SET
         hits         = CASE WHEN window_start <= ?4 THEN 1 ELSE hits + 1 END,
         window_start = CASE WHEN window_start <= ?4 THEN ?3 ELSE window_start END`,
    )
    .bind(policy.bucket, identifier, now, stale)
    .run();
}

export interface TurnstileResult {
  success: boolean;
  codes: string[];
}

export async function verifyTurnstile(
  token: string,
  remoteIp: string,
  secret: string,
  expectedHostname?: string,
): Promise<TurnstileResult> {
  try {
    const body = new FormData();
    body.set('secret', secret);
    body.set('response', token);
    if (remoteIp && remoteIp !== 'unknown') body.set('remoteip', remoteIp);

    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });

    if (!response.ok) return { success: false, codes: ['network'] };

    const data = (await response.json()) as {
      success?: boolean;
      'error-codes'?: string[];
      hostname?: string;
    };

    if (!data.success) return { success: false, codes: data['error-codes'] ?? ['unknown'] };

    // A token minted for another site must not be accepted here.
    if (expectedHostname && data.hostname && data.hostname !== expectedHostname) {
      return { success: false, codes: ['hostname-mismatch'] };
    }

    return { success: true, codes: [] };
  } catch {
    return { success: false, codes: ['network'] };
  }
}

/** Cheap timing check: a human cannot complete this form in under 2 seconds. */
export const MIN_FILL_MS = 2000;
