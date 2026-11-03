/**
 * Cron entry point for the capture dispatcher.
 *
 * Cloudflare cron triggers invoke this Worker with no request. It claims a
 * small batch of due jobs and runs the preview pipeline. Kept to a small batch
 * because the free tier grants a cron invocation only 10ms of CPU: the work
 * that actually costs time is outbound fetch and browser capture, neither of
 * which is CPU time, but a tight bound still protects the daily request quota.
 */

import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '~/lib/env';
import { getEnv, getDb } from '~/lib/env';
import { dispatch } from '~/lib/dispatcher';
import { authenticate, unauthorized } from '~/lib/admin-auth';
import { checkRateLimit, getPolicy, getRateLimitIdentifier } from '~/lib/rate-limit';

// MUST be false. Without it Astro prerenders this route to a static file at
// build time, and the cron trigger then hits that frozen JSON forever — the
// dispatcher never runs and no project is ever captured.
export const prerender = false;

/**
 * Authenticated dispatch endpoint.
 *
 * This route used to be open to the world: anyone who guessed it could drain
 * the capture provider's quota and the D1 write budget by triggering dispatch
 * on every request. It now requires the same bearer secret as `/admin`, which
 * is what `scripts/build.mjs` injects when the Worker's `scheduled` handler
 * calls this route in-process.
 */
export const onRequest: APIRoute = async ({ request }) => {
  const env: Env = await getEnv();

  const session = await authenticate(request, env.ADMIN_TOKEN);
  if (!session.ok) {
    const denied = unauthorized(session.reason);
    return new Response(denied.body, { status: denied.status, headers: denied.headers });
  }

  // Rate limiting for cron dispatch endpoint
  const db: D1Database = getDb(env);
  const policy = getPolicy('cron-dispatch');
  const identifier = await getRateLimitIdentifier(request, env, policy);
  const limit = await checkRateLimit(db as never, identifier, policy);
  if (!limit.allowed) {
    console.log(JSON.stringify({ event: 'cron.rate_limited', outcome: 'rejected' }));
    return Response.json(
      { ok: false, error: 'Too many dispatch requests. Try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(limit.retryAfterSeconds ?? policy.windowMinutes * 60),
          'X-RateLimit-Limit': String(limit.limit ?? policy.max),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + (limit.retryAfterSeconds ?? policy.windowMinutes * 60)),
        }
      },
    );
  }

  const summary = await dispatch(env, db, 3);

  // Structured, and free of any project-identifying payload beyond the slug.
  console.log(JSON.stringify({ event: 'preview.dispatch', ...summary, results: undefined }));

  return Response.json({ ok: true, ...summary });
};

export const GET = onRequest;
export const POST = onRequest;
