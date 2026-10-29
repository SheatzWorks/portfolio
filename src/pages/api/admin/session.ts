/**
 * Sign-in form handler. Accepts a normal form POST and redirects, so the
 * sign-in page needs no JavaScript at all.
 */
import type { APIRoute } from 'astro';
import { getEnv } from '~/lib/env';
import { timingSafeEqualStr, sessionCookie, clearCookie } from '~/lib/admin-auth';

export const prerender = false;

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

  if (!message && (!token || !timingSafeEqualStr(token, env.ADMIN_TOKEN))) {
    // Slow the guess down so it cannot run at line speed.
    await new Promise((r) => setTimeout(r, 500));
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
