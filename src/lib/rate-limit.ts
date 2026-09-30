/**
 * Rate limiting and spam defence for the contact form.
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
 */

import type { D1Like } from './db';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds?: number;
}

const WINDOW_MINUTES = 60;
const MAX_SUBMISSIONS = 5;

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

export async function checkRateLimit(
  db: D1Like,
  identifier: string,
  bucket = 'contact',
  max = MAX_SUBMISSIONS,
): Promise<RateLimitResult> {
  const windowStart = iso(Date.now() - WINDOW_MINUTES * 60_000);

  const row = await db
    .prepare('SELECT hits, window_start FROM rate_limits WHERE bucket = ?1 AND identifier = ?2')
    .bind(bucket, identifier)
    .first<{ hits: number; window_start: string }>();

  // Missing row, or the window has rolled over: this is a fresh visitor.
  if (!row || row.window_start < windowStart) {
    return { allowed: true, remaining: max };
  }

  if (row.hits >= max) {
    return { allowed: false, remaining: 0, retryAfterSeconds: WINDOW_MINUTES * 60 };
  }

  return { allowed: true, remaining: max - row.hits - 1 };
}

/** SQLite's `datetime('now')` format, which is what the column stores. */
function iso(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

export async function recordAttempt(
  db: D1Like,
  identifier: string,
  bucket = 'contact',
): Promise<void> {
  const now = iso(Date.now());
  const stale = iso(Date.now() - WINDOW_MINUTES * 60_000);

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
    .bind(bucket, identifier, now, stale)
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
