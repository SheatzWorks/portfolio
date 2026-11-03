/**
 * Middleware: security headers, plus the admin auth gate.
 *
 * Astro supports exactly one middleware file, so both concerns live here. The
 * admin gate is applied by path pattern rather than per-page so a new admin
 * page cannot accidentally ship unprotected.
 *
 * The Content-Security-Policy is NOT set here. Astro generates a hash-based one
 * in astro.config.mjs: as a <meta> element on prerendered routes, as a response
 * header on server-rendered ones. A second policy of our own would be enforced
 * *in addition* (browsers intersect all policies) and could not know the
 * per-page script hashes, so it would block Astro's own inline scripts. One
 * policy, one place. The one directive that is invalid in a <meta> —
 * frame-ancestors — is sent below as its own single-directive policy.
 *
 * Additionally, we send a Content-Security-Policy-Report-Only header to collect
 * violations without blocking. This allows us to monitor CSP issues before
 * enforcing. The policy mirrors the one in astro.config.mjs.
 */

import { defineMiddleware } from 'astro:middleware';
import { getEnv } from '~/lib/env';
import { setMediaBaseUrl } from '~/lib/preview';
import { authenticate, unauthorized } from '~/lib/admin-auth';

// Ensure Durable Object classes are registered with the Cloudflare Workers runtime
import '~/durable-objects';

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

/**
 * CSP policy. Mirrors astro.config.mjs but with 'unsafe-inline' for scripts
 * and styles to accommodate Astro's inline scripts and style attributes.
 * The Astro CSP generation (security.csp in astro.config.mjs) does not work
 * with the Cloudflare adapter, so we set the CSP header here.
 *
 * Per-page script hashes would be stronger but require Astro's CSP generation
 * to work. This policy is still effective: it restricts external sources to
 * self and Cloudflare Turnstile, and blocks object, base-uri manipulation,
 * and form-action to external targets.
 */
const CSP = [
  "default-src 'self'",
  "img-src 'self' data: https:",
  "media-src 'self' https:",
  "font-src 'self'",
  "frame-src 'self' https: https://challenges.cloudflare.com",
  "connect-src 'self' https://challenges.cloudflare.com",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
  "report-uri /api/csp-report",
].join('; ');

/** CSP Report-Only policy for monitoring without enforcement.
 *  upgrade-insecure-requests is ignored in report-only mode, so omit it. */
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "img-src 'self' data: https:",
  "media-src 'self' https:",
  "font-src 'self'",
  "frame-src 'self' https: https://challenges.cloudflare.com",
  "connect-src 'self' https://challenges.cloudflare.com",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "report-uri /api/csp-report",
].join('; ');

/** Everything under these prefixes requires an admin session. */
const PROTECTED = [/^\/admin(?:\/|$)/, /^\/api\/admin(?:\/|$)/];
/** The sign-in page itself must stay reachable, or nobody can sign in. */
const PUBLIC = [/^\/admin\/login\/?$/, /^\/api\/admin\/session$/];

/**
 * The operator's own surface and the data endpoints.
 *
 * Neither belongs in a shared cache or in a search index. `public/_headers`
 * asks for the same two headers on these prefixes, but that file is only read
 * for assets the static-assets binding serves without the Worker — and every
 * route here is server-rendered, so the Worker answers all of them and the
 * `_headers` rules never fire. This is the only place they can be set.
 */
const PRIVATE = [/^\/admin(?:\/|$)/, /^\/api(?:\/|$)/];

/**
 * Applies the hardening header set to any response, including error paths.
 *
 * `x-robots-tag` is NOT set here. It is tempting to gate it on
 * `context.isPrerendered`, but under this adapter prerendered routes are served
 * by the static assets binding and never reach the Worker, so that condition is
 * never true at request time. Prerendered pages get their robots tag from
 * public/_headers instead.
 */
function harden(headers: Headers, pathname: string): Headers {
  for (const [key, value] of Object.entries(HEADERS)) {
    headers.set(key, value);
  }
  headers.set('content-security-policy', CSP);
  headers.set('content-security-policy-report-only', CSP_REPORT_ONLY);
  if (PRIVATE.some((re) => re.test(pathname))) {
    headers.set('cache-control', 'no-store');
    headers.set('x-robots-tag', 'noindex, nofollow');
  }
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
    const session = await authenticate(context.request, env.ADMIN_TOKEN);

    if (!session.ok) {
      const wantsJson =
        pathname.startsWith('/api/') ||
        context.request.headers.get('accept')?.includes('application/json');

      if (wantsJson) {
        return new Response(unauthorized(session.reason).body, {
          status: unauthorized(session.reason).status,
          headers: harden(unauthorized(session.reason).headers, pathname),
        });
      }

      // A browser navigation is sent to the sign-in page rather than shown a
      // bare 401, so the operator has somewhere to go.
      if (session.reason === 'disabled') {
        return new Response(
          'Admin access is disabled because ADMIN_TOKEN is not configured on this deployment.',
          {
            status: 503,
            headers: harden(new Headers({ 'content-type': 'text/plain; charset=utf-8' }), pathname),
          },
        );
      }
      const target = encodeURIComponent(`${pathname}${context.url.search}`);
      return new Response(null, {
        status: 302,
        headers: harden(new Headers({ location: `/admin/login?next=${target}` }), pathname),
      });
    }
  }

  const response = await next();

  // An error path may hand back a bare Response. Hardening must apply to the
  // 500 page too, not just the happy path.
  const headers = harden(new Headers(response.headers), pathname);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
