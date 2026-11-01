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
} from '~/lib/rate-limit';
import { timingSafeEqualStr, sessionCookie, clearCookie } from '~/lib/admin-auth';

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
  let message = '';

  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    try {
      const body = (await request.json()) as { token?: unknown; next?: unknown };
      token = typeof body.token === 'string' ? body.token : '';
      next = safeNext(typeof body.next === 'string' ? body.next : null);
    } catch {
      message = 'Invalid request.';
    }
  } else {
    const form = await request.formData().catch(() => null);
    token = String(form?.get('token') ?? '');
    next = safeNext(String(form?.get('next') ?? '/admin'));
  }

  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 16) {
    return new Response('Admin access is not configured on this deployment.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  // ---- Per-IP lockout, before the comparison ----------------------------
  let db: D1Database | null = null;
  let identifier = '';
  if (hasDb(env)) {
    db = getDb(env);
    identifier = await hashIdentifier(
      clientIp(request),
      env.RATE_LIMIT_SALT ?? 'no-salt-configured',
    );
    // `db as never` — the same cast contact.ts uses: the runtime binding
    // satisfies the D1Like contract at call time, but the ambient types make
    // the structural check unresolvable.
    const limit = await checkRateLimit(
      db as never,
      identifier,
      'admin-login',
      ADMIN_LOGIN_MAX,
    ).catch(() => null);
    if (limit && !limit.allowed) {
      // A distinct fate from a wrong token, so the operator who is fat-
      // fingering their own token can tell the difference from the logs —
      // but still no API shape that says WHICH check tripped to a prober.
      console.log(JSON.stringify({ event: 'admin.login_rate_limited', outcome: 'rejected' }));
      if (contentType.includes('application/json')) {
        return Response.json(
          { ok: false, error: 'Too many unsuccessful attempts. Try again in an hour.' },
          { status: 429 },
        );
      }
      return context302(request, `/admin/login?locked=1&next=${encodeURIComponent(next)}`);
    }
  }

  if (!message && (!token || !timingSafeEqualStr(token, env.ADMIN_TOKEN))) {
    // Slow the guess down so it cannot run at line speed.
    await new Promise((r) => setTimeout(r, 500));
    // The failed attempt is what earns the lockout, so only a wrong token
    // consumes one of the five. Limiter failures are swallowed: being unable
    // to count must not take sign-in down with it.
    if (db) void recordAttempt(db as never, identifier, 'admin-login').catch(() => {});
    if (contentType.includes('application/json')) {
      return Response.json({ ok: false, error: 'That token is not valid.' }, { status: 401 });
    }
    return context302(request, `/admin/login?error=1&next=${encodeURIComponent(next)}`);
  }

  const secure = url.protocol === 'https:';
  const cookie = sessionCookie(token, secure);

  if (contentType.includes('application/json')) {
    return new Response(JSON.stringify({ ok: true, next }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'set-cookie': cookie },
    });
  }

  return new Response(null, {
    status: 302,
    headers: { location: next, 'set-cookie': cookie },
  });
};

function context302(_request: Request, location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

export const DELETE: APIRoute = async () =>
  new Response(null, {
    status: 302,
    headers: {
      location: '/admin/login',
      'set-cookie': clearCookie(),
    },
  });
