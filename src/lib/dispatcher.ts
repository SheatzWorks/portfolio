/**
 * Capture job dispatcher.
 *
 * Runs on a Cloudflare cron trigger. Claims a small batch of due jobs, runs the
 * preview pipeline for each, and records the outcome. Jobs retry with
 * exponential backoff; after max_attempts they are marked failed and stay
 * visible in the admin rather than retrying forever.
 *
 * Why a D1 job table rather than Cloudflare Queues: a two-person studio adds a
 * handful of projects a month. Queues would be a second product to provision,
 * a consumer to deploy, and a DLQ to reason about, in exchange for durable
 * retries we get from three columns. The upgrade trigger is documented in
 * docs/architecture.md.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from './env';
import { generateMetadata, saveMetadata } from './metadata-pipeline';

export interface DispatchSummary {
  claimed: number;
  succeeded: number;
  partial: number;
  failed: number;
  results: { project: string; outcome: string; error?: string }[];
}

/** Claims up to `limit` due jobs, marking them running in the same pass. */
async function claimJobs(db: D1Database, limit: number): Promise<
  { id: number; projectId: number; kind: string; attempts: number; maxAttempts: number }[]
> {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  // D1 has no SELECT ... FOR UPDATE SKIP LOCKED. The cron is the only writer
  // and a single invocation claims the batch, so a plain conditional update is
  // sufficient: the WHERE state='pending' guard makes a second concurrent
  // invocation a no-op on the same rows.
  const due = await db
    .prepare(
      `SELECT j.id, j.project_id, j.kind, j.attempts, j.max_attempts
         FROM jobs j
         JOIN projects p ON p.id = j.project_id
        WHERE j.state = 'pending'
          AND j.run_after <= ?1
          -- Drafts still get their preview generated; being unpublished is not
          -- a reason to leave a card with no image.
          AND p.id IS NOT NULL
        ORDER BY j.run_after ASC
        LIMIT ?2`,
    )
    .bind(now, limit)
    .all<{
      id: number;
      project_id: number;
      kind: string;
      attempts: number;
      max_attempts: number;
    }>();

  const claimed: {
    id: number;
    projectId: number;
    kind: string;
    attempts: number;
    maxAttempts: number;
  }[] = [];

  for (const row of due.results) {
    const updated = await db
      .prepare(
        `UPDATE jobs SET state = 'running', attempts = attempts + 1
          WHERE id = ?1 AND state = 'pending'`,
      )
      .bind(row.id)
      .run();

    if ((updated.meta?.changes ?? 0) > 0) {
      claimed.push({
        id: row.id,
        projectId: row.project_id,
        kind: row.kind,
        attempts: row.attempts + 1,
        maxAttempts: row.max_attempts,
      });
    }
  }

  return claimed;
}

/**
 * A job is marked `running` before the work starts, and only the same
 * invocation clears it. If the Worker is evicted mid-capture (a deploy, a CPU
 * or wall-clock limit, a provider timeout that never rejects) the row stays
 * `running` forever: it is not pending, so nothing claims it again, and the
 * project silently never gets a preview.
 *
 * Reclaim anything that has been running longer than a capture could plausibly
 * take. The attempt counter was already incremented when it was claimed, so a
 * repeatedly-killed job still exhausts max_attempts instead of looping.
 */
const STALE_RUNNING_MINUTES = 15;

async function reclaimStaleJobs(db: D1Database): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE jobs
          SET state = 'pending',
              last_error = 'reclaimed: still running after ' || ?1 || ' minutes'
        WHERE state = 'running'
          AND updated_at <= datetime('now', '-' || ?1 || ' minutes')`,
    )
    .bind(STALE_RUNNING_MINUTES)
    .run();
  const reclaimed = result.meta?.changes ?? 0;
  if (reclaimed > 0) {
    console.warn(JSON.stringify({ event: 'dispatch.reclaimed', count: reclaimed }));
  }
  return reclaimed;
}

/** Exponential backoff: 5m, 20m, 80m, capped at a day. */
function backoffSeconds(attempts: number): number {
  return Math.min(300 * 4 ** Math.max(0, attempts - 1), 86_400);
}

async function finishJob(
  db: D1Database,
  job: { id: number; attempts: number; maxAttempts: number },
  outcome: 'done' | 'retry' | 'failed',
  error?: string,
): Promise<void> {
  if (outcome === 'done') {
    await db
      .prepare(`UPDATE jobs SET state = 'done', last_error = NULL WHERE id = ?1`)
      .bind(job.id)
      .run();
    return;
  }

  if (job.attempts >= job.maxAttempts) {
    await db
      .prepare(`UPDATE jobs SET state = 'failed', last_error = ?2 WHERE id = ?1`)
      .bind(job.id, (error ?? 'unknown').slice(0, 500))
      .run();
    return;
  }

  const delay = backoffSeconds(job.attempts);
  const runAfter = new Date(Date.now() + delay * 1000).toISOString().replace('T', ' ').slice(0, 19);
  await db
    .prepare(`UPDATE jobs SET state = 'pending', run_after = ?2, last_error = ?3 WHERE id = ?1`)
    .bind(job.id, runAfter, (error ?? 'unknown').slice(0, 500))
    .run();
}

/**
 * One dispatch pass. Safe to run concurrently: the claim is conditional.
 */
export async function dispatch(env: Env, db: D1Database, limit = 3): Promise<DispatchSummary> {
  const summary: DispatchSummary = { claimed: 0, succeeded: 0, partial: 0, failed: 0, results: [] };

  let jobs: Awaited<ReturnType<typeof claimJobs>>;
  try {
    await reclaimStaleJobs(db);
    jobs = await claimJobs(db, limit);
  } catch (err) {
    console.error(JSON.stringify({ event: 'dispatch.claim_failed', error: String(err) }));
    return summary;
  }

  summary.claimed = jobs.length;

  for (const job of jobs) {
    try {
      const project = await db
        .prepare('SELECT id, slug, url, title, blurb FROM projects WHERE id = ?1')
        .bind(job.projectId)
        .first<{ id: number; slug: string; url: string; title: string; blurb: string | null }>();

      if (!project) {
        await finishJob(db, job, 'done');
        continue;
      }

      await db
        .prepare(`UPDATE projects SET preview_state = 'metadata' WHERE id = ?1`)
        .bind(project.id)
        .run();

      // Capture only when the row has no usable image yet. Re-capturing on
      // every dispatch would burn the provider's quota for nothing and fight
      // with the capture script, which owns the full responsive set.
      const preview = await db
        .prepare('SELECT preview FROM projects WHERE id = ?1')
        .bind(project.id)
        .first<{ preview: string | null }>();
      let hasImage = false;
      try {
        const parsed = preview?.preview ? (JSON.parse(preview.preview) as Record<string, unknown>) : {};
        hasImage = Boolean(parsed.thumb ?? parsed.poster ?? parsed.og);
      } catch {
        hasImage = false;
      }

      const result = await generateMetadata(env, project, { allowCapture: !hasImage });

      if (result.ok) {
        await saveMetadata(db, project.id, result.preview, {
          title: result.suggestedTitle,
          description: result.suggestedDescription,
        });
      } else {
        // Still persist what we learned, so the admin shows why it failed.
        await saveMetadata(db, project.id, result.preview);
      }

      if (result.outcome === 'og-only' || result.outcome === 'metadata') summary.succeeded++;
      else summary.partial++;

      summary.results.push({ project: project.slug, outcome: result.outcome });

      // A challenge page or an unsafe URL will not fix itself on retry; a
      // transient network failure will.
      const worthRetrying =
        !result.ok && result.outcome === 'failed' && result.preview.note !== 'blocked-host';
      await finishJob(db, job, result.ok ? 'done' : worthRetrying ? 'retry' : 'failed', result.error);
    } catch (err) {
      summary.failed++;
      const message = err instanceof Error ? err.message : String(err);
      summary.results.push({ project: `#${job.projectId}`, outcome: 'error', error: message });
      await finishJob(db, job, 'retry', message);
    }
  }

  return summary;
}

/** Queues a preview job, coalescing with any job already pending for the project. */
export async function enqueuePreview(
  db: D1Database,
  projectId: number,
  kind: 'preview' | 'metadata' | 'video' = 'preview',
): Promise<number> {
  const existing = await db
    .prepare(
      `SELECT id FROM jobs WHERE project_id = ?1 AND state IN ('pending','running') AND kind = ?2`,
    )
    .bind(projectId, kind)
    .first<{ id: number }>();

  if (existing) return existing.id;

  const result = await db
    .prepare(`INSERT INTO jobs (project_id, kind) VALUES (?1, ?2)`)
    .bind(projectId, kind)
    .run();

  return Number(result.meta?.last_row_id ?? 0);
}
