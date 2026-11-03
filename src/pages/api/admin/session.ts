/**
 * Sign-in form handler. Accepts a normal form POST and redirects, so the
 * sign-in page needs no JavaScript at all.
 */
import type { APIRoute } from 'astro';
import { getEnv, getDb, hasDb } from '~/lib/env';
import {
  checkRateLimit,
  recordAttempt,
  clientIp,
  hashIdentifier,
  getPolicy,
  getRateLimitIdentifier,
} from '~/lib/rate-limit';
import { timingSafeEqualStr, sessionCookie, clearCookie, authenticate, type AdminTotpEnrollment } from '~/lib/admin-auth';
import { generateCsrfToken, csrfCookie, clearCsrfCookie } from '~/lib/csrf';
import { enrollTotp } from '~/lib/totp';
import type { TotpEnrollment } from '~/lib/totp';

export const prerender = false;

/**
 * Consecutive failed sign-ins per IP, per hour.
 *
 * The 500 ms delay below is necessary but not sufficient: it never slows a
 * request that goes out in parallel, so without a lockout a thousand requests
 * an hour are unaffected by it. Five wrong tokens lock the address out for
 * the rest of the hour — long enough to make guessing pointless, short
 * enough that the studio being the only user is never locked out by their
 * own typo. Same D1 table the contact form limits on, so there is no new
 * mechanism and no new infrastructure: one limiter, audited once.
 */
const ADMIN_LOGIN_MAX = 5;

/** Only same-origin relative paths, so `next` cannot be an open redirect. */
function safeNext(raw: string | null): string {
  if (!raw) return '/admin';
  if (!raw.startsWith('/')) return '/admin';
  // `//host` and `/\host` both normalise to a protocol-relative URL under
  // WHATWG parsing, which is an open redirect after authentication.
  if (raw.startsWith('//') || raw.startsWith('/\\') || /[\\\s]/.test(raw)) return '/admin';
  return raw;
}

export const POST: APIRoute = async ({ request }) => {
  const env = await getEnv();
  const url = new URL(request.url);


  let token = '';
  let next = '/admin';
  let mfaCode = '';
  let action = '';
  let message = '';
  let db: D1Database | null = null;
  let identifier = '';

  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    try {
      const body = (await request.json()) as { 
        token?: unknown; 
        next?: unknown; 
        mfaCode?: unknown;
        action?: unknown;
      };
      token = typeof body.token === 'string' ? body.token : '';
      mfaCode = typeof body.mfaCode === 'string' ? body.mfaCode : '';
      next = safeNext(typeof body.next === 'string' ? body.next : null);
      action = typeof body.action === 'string' ? body.action : '';
    } catch {
      message = 'Invalid request.';
    }
  } else {
    const form = await request.formData().catch(() => null);
    token = String(form?.get('token') ?? '');
    mfaCode = String(form?.get('mfaCode') ?? '');
    next = safeNext(String(form?.get('next') ?? '/admin'));
    action = String(form?.get('action') ?? '');
  }

  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 16) {
    return new Response('Admin access is not configured on this deployment.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  // ---- Per-IP rate limiting, before the comparison ---------------------------
  if (hasDb(env)) {
    db = getDb(env);
    identifier = await getRateLimitIdentifier(request, env, getPolicy('admin-login'));
    const limit = await checkRateLimit(
      db as never,
      identifier,
      getPolicy('admin-login'),
    ).catch(() => null);
    if (limit && !limit.allowed) {
      console.log(JSON.stringify({ event: 'admin.login_rate_limited', outcome: 'rejected' }));
      if (contentType.includes('application/json')) {
        return Response.json(
          { ok: false, error: 'Too many unsuccessful attempts. Try again in an hour.' },
          {
            status: 429,
            headers: {
              'Retry-After': String(limit.retryAfterSeconds ?? 60 * 60),
              'X-RateLimit-Limit': String(limit.limit ?? 5),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + (limit.retryAfterSeconds ?? 60 * 60)),
            },
          },
        );
      }
      return context302(request, `/admin/login?locked=1&next=${encodeURIComponent(next)}`);
    }
  }

  // Handle TOTP enrollment action
  if (action === 'enroll-totp') {
    if (!hasDb(env)) {
      return Response.json({ ok: false, error: 'Database not available' }, { status: 503 });
    }
    db = getDb(env);
    const pepper = env.MFA_PEPPER ?? env.ADMIN_TOKEN;
    const enrollment = await enrollTotp(pepper);
    
    // Store enrollment in D1 (replace any existing)
    await db.prepare(`
      INSERT INTO admin_totp (secret, recovery_codes, recovery_code_hashes, enrolled_at)
      VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(rowid) DO UPDATE SET
        secret = excluded.secret,
        recovery_codes = excluded.recovery_codes,
        recovery_code_hashes = excluded.recovery_code_hashes,
        enrolled_at = excluded.enrolled_at
    `).bind(
      enrollment.secret,
      JSON.stringify(enrollment.recoveryCodes),
      JSON.stringify(enrollment.recoveryCodeHashes),
      enrollment.enrolledAt
    ).run();

    const secure = url.protocol === 'https:';
    const csrf = generateCsrfToken(env.ADMIN_TOKEN);
    const csrfCookieValue = csrfCookie(csrf, secure);
    
    if (contentType.includes('application/json')) {
      const headers = new Headers();
      headers.set('content-type', 'application/json');
      headers.append('set-cookie', csrfCookieValue);
      return new Response(JSON.stringify({ 
        ok: true, 
        recoveryCodes: enrollment.recoveryCodes,
        secret: enrollment.secret // only returned once during enrollment
      }), { status: 200, headers });
    }
    
    const headers = new Headers();
    headers.set('location', '/admin/totp-enrollment');
    headers.append('set-cookie', csrfCookieValue);
    return new Response(null, { status: 302, headers });
  }

  // Handle TOTP verification during login
  if (action === 'verify-totp') {
    if (!hasDb(env)) {
      return Response.json({ ok: false, error: 'Database not available' }, { status: 503 });
    }
    db = getDb(env);
    const pepper = env.MFA_PEPPER ?? env.ADMIN_TOKEN;
    
    // Load TOTP enrollment from D1
    const enrollmentRow = await db.prepare(`
      SELECT secret, recovery_code_hashes, enrolled_at FROM admin_totp LIMIT 1
    `).first<{ secret: string; recovery_code_hashes: string; enrolled_at: number }>();
    
    let totpEnrollment: TotpEnrollment | null = null;
    if (enrollmentRow) {
      totpEnrollment = {
        secret: enrollmentRow.secret,
        recoveryCodes: [], // not stored in DB for security
        recoveryCodeHashes: JSON.parse(enrollmentRow.recovery_code_hashes),
        enrolledAt: enrollmentRow.enrolled_at,
      };
    }
    
    const { verifyTotpOrRecovery } = await import('~/lib/totp');
    const mfaResult = await verifyTotpOrRecovery(totpEnrollment, mfaCode, pepper);
    
    if (!mfaResult.ok) {
      if (contentType.includes('application/json')) {
        return Response.json({ ok: false, error: mfaResult.reason === 'recovery-code-used' ? 'Recovery code already used' : 'Invalid MFA code' }, { status: 401 });
      }
      return context302(request, `/admin/login?error=mfa&next=${encodeURIComponent(next)}`);
    }
    
    // MFA verified, proceed with normal login
    // Fall through to token verification below
  }

  if (!message && (!token || !timingSafeEqualStr(token, env.ADMIN_TOKEN))) {
    // Slow the guess down so it cannot run at line speed.
    await new Promise((r) => setTimeout(r, 500));
    // The failed attempt is what earns the lockout, so only a wrong token
    // consumes one of the five. Limiter failures are swallowed: being unable
    // to count must not take sign-in down with it.
    const policy = getPolicy('admin-login');
    if (db) void recordAttempt(db as never, identifier, policy).catch(() => {});
    if (contentType.includes('application/json')) {
      return Response.json({ ok: false, error: 'That token is not valid.' }, { status: 401 });
    }
    return context302(request, `/admin/login?error=1&next=${encodeURIComponent(next)}`);
  }

  const secure = url.protocol === 'https:';
  const cookie = sessionCookie(token, secure);
  const csrf = generateCsrfToken(env.ADMIN_TOKEN);
  const csrfCookieValue = csrfCookie(csrf, secure);
  const headers = new Headers();
  headers.set('content-type', 'application/json');
  headers.append('set-cookie', cookie);
  headers.append('set-cookie', csrfCookieValue);

  if (contentType.includes('application/json')) {
    return new Response(JSON.stringify({ ok: true, next }), {
      status: 200,
      headers,
    });
  }

  const redirectHeaders = new Headers();
  redirectHeaders.set('location', next);
  redirectHeaders.append('set-cookie', cookie);
  redirectHeaders.append('set-cookie', csrfCookieValue);
  return new Response(null, {
    status: 302,
    headers: redirectHeaders,
  });
};

function context302(_request: Request, location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

export const DELETE: APIRoute = async () => {
  const headers = new Headers();
  headers.set('location', '/admin/login');
  headers.append('set-cookie', clearCookie());
  headers.append('set-cookie', clearCsrfCookie());
  return new Response(null, { status: 302, headers });
};
