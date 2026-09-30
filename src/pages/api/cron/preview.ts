/**
 * Cron entry point for the capture dispatcher.
 *
 * Cloudflare cron triggers invoke this Worker with no request. It claims a
 * small batch of due jobs and runs the preview pipeline. Kept to a small batch
 * because the free tier grants a cron invocation only 10ms of CPU: the work
 * that actually costs time is outbound fetch and browser capture, neither of
 * which is CPU time, but a tight bound still protects the daily request quota.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '~/lib/env';
import { getEnv, getDb } from '~/lib/env';
import { dispatch } from '~/lib/dispatcher';

// MUST be false. Without it Astro prerenders this route to a static file at
// build time, and the cron trigger then hits that frozen JSON forever — the
// dispatcher never runs and no project is ever captured.
export const prerender = false;

export const onRequest = async () => {
  const env: Env = await getEnv();
  const db: D1Database = getDb(env);

  const summary = await dispatch(env, db, 3);

  // Structured, and free of any project-identifying payload beyond the slug.
  console.log(JSON.stringify({ event: 'preview.dispatch', ...summary, results: undefined }));

  return Response.json({ ok: true, ...summary });
};

export const GET = onRequest;
export const POST = onRequest;
