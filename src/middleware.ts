/**
 * Middleware: security headers, plus the admin auth gate.
 *
 * Astro supports exactly one middleware file, so both concerns live here. The
 * admin gate is applied by path pattern rather than per-page so a new admin
 * page cannot accidentally ship unprotected.
 *
 * The Content-Security-Policy is NOT set here. Astro generates a hash-based one
 * in astro.config.mjs and emits it as a <meta> element. A second policy
 * delivered as an HTTP header would be enforced *in addition* (browsers
 * intersect all policies), and because a header cannot know the per-page
 * script hashes, it would block Astro's own inline scripts. One policy, one
 * place. The one directive that is invalid in a <meta> — frame-ancestors — is
 * sent below as its own single-directive policy.
 */

import { defineMiddleware } from 'astro:middleware';
import { getEnv } from '~/lib/env';
import { setMediaBaseUrl } from '~/lib/preview';
import { authenticate, unauthorized } from '~/lib/admin-auth';

const HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};

const FRAME_ANCESTORS = "frame-ancestors 'none'";

/** Everything under these prefixes requires an admin session. */
const PROTECTED = [/^\/admin(?:\/|$)/, /^\/api\/admin(?:\/|$)/];
/** The sign-in page itself must stay reachable, or nobody can sign in. */
const PUBLIC = [/^\/admin\/login\/?$/, /^\/api\/admin\/session$/];

/**
 * Applies the hardening header set to any response, including error paths.
 *
 * `x-robots-tag` is NOT set here. It is tempting to gate it on
 * `context.isPrerendered`, but under this adapter prerendered routes are served
 * by the static assets binding and never reach the Worker, so that condition is
 * never true at request time. Prerendered pages get their robots tag from
 * public/_headers instead.
 */
function harden(headers: Headers): Headers {
  for (const [key, value] of Object.entries(HEADERS)) {
    headers.set(key, value);
  }
  headers.append('content-security-policy', FRAME_ANCESTORS);
  return headers;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // Resolve the media origin once per request so `resolvePreview` stays a pure
  // synchronous function. The admin does not need it, and skipping the call
  // there keeps a broken value from affecting an unrelated route.
  if (!pathname.startsWith('/admin') && !pathname.startsWith('/api/admin')) {
    setMediaBaseUrl((await getEnv()).MEDIA_BASE_URL);
  }

  if (PROTECTED.some((re) => re.test(pathname)) && !PUBLIC.some((re) => re.test(pathname))) {
    const env = await getEnv();
    const session = authenticate(context.request, env.ADMIN_TOKEN);

    if (!session.ok) {
      const wantsJson =
        pathname.startsWith('/api/') ||
        context.request.headers.get('accept')?.includes('application/json');

      if (wantsJson) {
        return new Response(unauthorized(session.reason).body, {
          status: unauthorized(session.reason).status,
          headers: harden(unauthorized(session.reason).headers),
        });
      }

      // A browser navigation is sent to the sign-in page rather than shown a
      // bare 401, so the operator has somewhere to go.
      if (session.reason === 'disabled') {
        return new Response(
          'Admin access is disabled because ADMIN_TOKEN is not configured on this deployment.',
          {
            status: 503,
            headers: harden(new Headers({ 'content-type': 'text/plain; charset=utf-8' })),
          },
        );
      }
      const target = encodeURIComponent(`${pathname}${context.url.search}`);
      return new Response(null, {
        status: 302,
        headers: harden(new Headers({ location: `/admin/login?next=${target}` })),
      });
    }
  }

  const response = await next();

  // An error path may hand back a bare Response. Hardening must apply to the
  // 500 page too, not just the happy path.
  const headers = harden(new Headers(response.headers));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
