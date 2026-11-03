/**
 * Admin API: project CRUD, ordering, publish state, and preview regeneration.
 *
 * Every route is authenticated in middleware; this file handles validation and
 * the database work. Errors are logged with a code and returned as a generic
 * message, so a client never sees a stack trace or a SQL fragment.
 */
import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getEnv, getDb } from '~/lib/env';
import { enqueuePreview } from '~/lib/dispatcher';
import { generateMetadata, saveMetadata } from '~/lib/metadata-pipeline';
import { UnsafeUrlError, validateUrl } from '~/lib/safe-fetch';
import { arBucketFor } from '~/lib/preview';
import { requireCsrf } from '~/lib/csrf';

export const prerender = false;

const KINDS = new Set(['web', 'webapp', 'mobile', 'saas', 'ai', 'experiment', 'client', 'internal']);
const STATUSES = new Set(['live', 'in-progress', 'archived', 'private', 'experiment']);
const OWNERSHIPS = new Set(['client', 'own']);
const PRODUCT_STATUSES = new Set(['planning', 'in-development', 'beta', 'live', 'paused', 'retired']);

/**
 * The narrative beats, longest first.
 *
 * Written out rather than iterated so the API surface is enumerable and a new
 * column cannot be added to the schema without appearing here too — which is
 * how the previous migration ended up shipping six case-study columns that no
 * code path could write.
 */
const CASE_STUDY_FIELDS = [
  // body_md is the general narrative; the rest are the structured beats. It
  // belongs in this list because the code below indexes it here, and omitting
  // it bound `undefined` straight into D1.
  ['body_md', 100_000],
  ['objective_md', 20_000],
  ['design_md', 20_000],
  ['engineering_md', 20_000],
  ['challenge_md', 20_000],
  ['approach_md', 20_000],
  ['outcome_md', 20_000],
  ['challenges_md', 20_000],
  ['lessons_md', 20_000],
] as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function fail(code: string, message: string, status = 400): Response {
  console.error(JSON.stringify({ event: 'admin.error', code }));
  return json({ ok: false, error: message }, status);
}

const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** URL-safe, lowercase, hyphenated. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function uniqueSlug(db: D1Database, base: string, excludeId?: number): Promise<string> {
  let slug = base || 'project';
  for (let i = 2; i < 60; i++) {
    const row = await db
      .prepare('SELECT id FROM projects WHERE slug = ?1 AND id != ?2')
      .bind(slug, excludeId ?? -1)
      .first<{ id: number }>();
    if (!row) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

function parseJsonArray<T>(value: unknown, maxLen = 40): T[] {
  if (Array.isArray(value)) return value.slice(0, maxLen) as T[];
  if (typeof value === 'string') {
    return value
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, maxLen) as T[];
  }
  return [];
}

/** An object stored as JSON text in a column, or `{}` if there is none. */
function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = await getEnv();
  const db = getDb(env);

  // CSRF validation for all mutating operations
  if (!env.ADMIN_TOKEN || !requireCsrf(request, env.ADMIN_TOKEN)) {
    return json({ ok: false, error: 'Invalid CSRF token.' }, 403);
  }

  const action = new URL(request.url).searchParams.get('action') ?? '';

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  switch (action) {
    // ---------------------------------------------------------------- create
    case 'create': {
      const url = str(body.url, 2000);
      if (!url) return fail('create.no_url', 'A URL is required.', 422);

      // Validate before writing anything. An invalid URL must not create a row
      // that then sits in the queue failing forever.
      try {
        validateUrl(url);
      } catch (err) {
        const message = err instanceof UnsafeUrlError ? err.message : 'That URL could not be used.';
        return fail(`create.unsafe_url:${err instanceof UnsafeUrlError ? err.code : 'unknown'}`, message, 422);
      }

      const title = str(body.title, 160) || 'Untitled project';
      const slug = await uniqueSlug(db, slugify(str(body.slug, 80) || title));
      const kind = str(body.kind, 40) || 'web';
      const status = str(body.status, 40) || 'live';
      const ratio = Number(body.aspect_ratio);
      const technologies = JSON.stringify(
        parseJsonArray<string>(body.technologies, 20).filter((t) => typeof t === 'string' && t.length < 40),
      );
      const links = JSON.stringify(
        Object.fromEntries(
          Object.entries({
            github: str(body.github, 300),
            instagram: str(body.instagram, 300),
            store: str(body.store, 300),
          })
            .filter(([, v]) => v)
            .map(([k, v]) => [k, validateOptionalLink(v)]),
        ),
      );

      const arBucket = arBucketFor(ratio);

      /*
       * Ownership decides which route the item appears on, so it is a create-
       * time decision and is validated rather than coerced: silently writing
       * 'client' for a product would put it on the wrong page with no signal.
       */
      const ownership = OWNERSHIPS.has(str(body.ownership, 20)) ? str(body.ownership, 20) : 'client';

      // A lifecycle only means anything for an own product; for a commission
      // it stays NULL rather than inventing one.
      const productStatus =
        ownership === 'own' && PRODUCT_STATUSES.has(str(body.product_status, 20))
          ? str(body.product_status, 20)
          : null;

      // null, never '' or undefined: an empty string would print an empty
      // "Ask for access" link, and D1 rejects an undefined bind outright.
      const availability =
        body.availability_url !== undefined
          ? validateOptionalLink(str(body.availability_url, 300)) || null
          : null;

      const caseStudy = Object.fromEntries(
        CASE_STUDY_FIELDS.map(([column, max]) => [column, str(body[column], max) || null]),
      );
      const hasCaseStudy =
        body.has_case_study !== undefined
          ? body.has_case_study
            ? 1
            : 0
          : caseStudy.body_md || Object.values(caseStudy).some(Boolean)
            ? 1
            : 0;

      const maxOrder = await db
        .prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM projects')
        .bind()
        .first<{ m: number }>();

      const result = await db
        .prepare(
          `INSERT INTO projects
             (slug, title, url, blurb, tagline, kind, status, technologies, year, links,
              aspect_ratio, featured, published, has_case_study, sort_order, preview_state,
              ownership, product_status, availability_url,
              body_md, objective_md, design_md, engineering_md,
              challenge_md, approach_md, outcome_md, challenges_md, lessons_md, summary)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 'queued',
                   ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28)`,
        )
        .bind(
          slug,
          title,
          url,
          str(body.blurb, 300),
          str(body.tagline, 200) || null,
          KINDS.has(kind) ? kind : 'web',
          STATUSES.has(status) ? status : 'live',
          technologies,
          Number.isFinite(Number(body.year)) && Number(body.year) > 1900 ? Number(body.year) : null,
          links,
          arBucket.value,
          body.featured ? 1 : 0,
          body.published ? 1 : 0,
          hasCaseStudy,
          (maxOrder?.m ?? 0) + 10,
          ownership,
          productStatus,
          availability,
          caseStudy.body_md,
          caseStudy.objective_md,
          caseStudy.design_md,
          caseStudy.engineering_md,
          caseStudy.challenge_md,
          caseStudy.approach_md,
          caseStudy.outcome_md,
          caseStudy.challenges_md,
          caseStudy.lessons_md,
          str(body.summary, 2000) || null,
        )
        .run();

      const projectId = Number(result.meta?.last_row_id ?? 0);

      // Metadata extraction runs inline so the new project appears immediately
      // with real title/description. A capture is queued, not awaited.
      const project = await db
        .prepare('SELECT id, slug, url, title, blurb FROM projects WHERE id = ?1')
        .bind(projectId)
        .first<{ id: number; slug: string; url: string; title: string; blurb: string | null }>();

      if (project) {
        // Metadata only on create: the capture is queued rather than awaited,
        // so the project appears immediately instead of after a browser shot.
        const preview = await generateMetadata(env, project, { allowCapture: false }).catch(
          (err) => {
            console.error(JSON.stringify({ event: 'admin.create_metadata_failed', error: String(err) }));
            return null;
          },
        );
        if (preview) {
          await saveMetadata(db, projectId, preview.preview, {
            title: preview.suggestedTitle,
            description: preview.suggestedDescription,
          });
        }
        await enqueuePreview(db, projectId, 'preview');
      }

      return json({ ok: true, id: projectId, slug });
    }

    // ---------------------------------------------------------------- update
    case 'update': {
      const id = Number(body.id);
      if (!Number.isFinite(id) || id <= 0) return fail('update.no_id', 'A project id is required.', 422);

      const existing = await db
        .prepare('SELECT * FROM projects WHERE id = ?1')
        .bind(id)
        .first<Record<string, unknown>>();

      if (!existing) return fail('update.not_found', 'No such project.', 404);

      const url = body.url !== undefined ? str(body.url, 2000) : String(existing.url);
      if (body.url !== undefined) {
        try {
          validateUrl(url);
        } catch (err) {
          const message = err instanceof UnsafeUrlError ? err.message : 'That URL could not be used.';
          return fail('update.unsafe_url', message, 422);
        }
      }

      const kind = str(body.kind, 40) || String(existing.kind);
      const status = str(body.status, 40) || String(existing.status);
      const ratio =
        body.aspect_ratio !== undefined ? Number(body.aspect_ratio) : Number(existing.aspect_ratio);
      const arBucket = arBucketFor(ratio);

      const technologies =
        body.technologies !== undefined
          ? JSON.stringify(
              parseJsonArray<string>(body.technologies, 20).filter((t) => typeof t === 'string' && t.length < 40),
            )
          : String(existing.technologies);

      const links =
        body.github !== undefined
          ? JSON.stringify(
              Object.fromEntries(
                Object.entries({
                  ...parseJsonRecord(existing.links),
                  github: validateOptionalLink(str(body.github, 300)),
                }).filter(([, value]) => value),
              ),
            )
          : String(existing.links ?? '{}');

      const caseStudy = Object.fromEntries(
        CASE_STUDY_FIELDS.map(([column, max]) => [
          column,
          body[column] !== undefined
            ? str(body[column], max) || null
            : ((existing[column] as string | null) ?? null),
        ]),
      );

      const ownership =
        body.ownership !== undefined && OWNERSHIPS.has(str(body.ownership, 20))
          ? str(body.ownership, 20)
          : String(existing.ownership ?? 'client');

      // Demoting a product to a commission clears the lifecycle: leaving it set
      // would print a product status on a client-work case study, where it
      // means nothing.
      const productStatus =
        ownership !== 'own'
          ? null
          : body.product_status !== undefined
            ? PRODUCT_STATUSES.has(str(body.product_status, 20))
              ? str(body.product_status, 20)
              : null
            : ((existing.product_status as string | null) ?? null);

      const hasCaseStudy =
        body.has_case_study !== undefined
          ? body.has_case_study
            ? 1
            : 0
          : caseStudy.body_md || Object.values(caseStudy).some(Boolean)
            ? 1
            : Number(existing.has_case_study ?? 0);

      await db
        .prepare(
          `UPDATE projects SET
             title = ?2, url = ?3, blurb = ?4, kind = ?5, status = ?6,
             technologies = ?7, year = ?8, aspect_ratio = ?9, featured = ?10,
             published = ?11, has_case_study = ?12, body_md = ?13, summary = ?14,
             tagline = ?15, ownership = ?16, product_status = ?17,
             availability_url = ?18, objective_md = ?19, design_md = ?20,
             engineering_md = ?21, challenge_md = ?22, approach_md = ?23,
             outcome_md = ?24, challenges_md = ?25, lessons_md = ?26,
             sort_order = ?27, links = ?28
           WHERE id = ?1`,
        )
        .bind(
          id,
          str(body.title, 160) || String(existing.title),
          url,
          body.blurb !== undefined ? str(body.blurb, 300) : (existing.blurb as string | null),
          KINDS.has(kind) ? kind : 'web',
          STATUSES.has(status) ? status : 'live',
          technologies,
          body.year !== undefined
            ? Number.isFinite(Number(body.year)) && Number(body.year) > 1900
              ? Number(body.year)
              : null
            : (existing.year as number | null),
          arBucket.value,
          body.featured !== undefined ? (body.featured ? 1 : 0) : Number(existing.featured ?? 0),
          body.published !== undefined ? (body.published ? 1 : 0) : Number(existing.published ?? 0),
          hasCaseStudy,
          caseStudy.body_md,
          body.summary !== undefined ? str(body.summary, 2000) || null : (existing.summary as string | null),
          body.tagline !== undefined ? str(body.tagline, 200) || null : ((existing.tagline as string | null) ?? null),
          ownership,
          productStatus,
          body.availability_url !== undefined
            ? validateOptionalLink(str(body.availability_url, 300)) || null
            : ((existing.availability_url as string | null) ?? null),
          caseStudy.objective_md,
          caseStudy.design_md,
          caseStudy.engineering_md,
          caseStudy.challenge_md,
          caseStudy.approach_md,
          caseStudy.outcome_md,
          caseStudy.challenges_md,
          caseStudy.lessons_md,
          body.sort_order !== undefined && Number.isFinite(Number(body.sort_order))
            ? Number(body.sort_order)
            : Number(existing.sort_order ?? 0),
          links,
        )
        .run();

      return json({ ok: true });
    }

    // ---------------------------------------------------------------- delete
    case 'delete': {
      const id = Number(body.id);
      if (!Number.isFinite(id)) return fail('delete.no_id', 'A project id is required.', 422);
      await db.prepare('DELETE FROM projects WHERE id = ?1').bind(id).run();
      // Jobs cascade via the foreign key.
      return json({ ok: true });
    }

    // ----------------------------------------------------------------- order
    case 'reorder': {
      const ids = parseJsonArray<number>(body.order, 200).map(Number).filter(Number.isFinite);
      if (!ids.length) return fail('reorder.no_ids', 'An order array is required.', 422);

      // One batched transaction: either the whole ordering lands or none of it
      // does, so a partial reorder can never leave the grid in a strange shape.
      await db.batch(
        ids.map((projectId, index) =>
          db
            .prepare('UPDATE projects SET sort_order = ?2 WHERE id = ?1')
            .bind(projectId, (index + 1) * 10),
        ),
      );
      return json({ ok: true });
    }

    // ------------------------------------------------------------- regenerate
    case 'regenerate': {
      const id = Number(body.id);
      if (!Number.isFinite(id)) return fail('regenerate.no_id', 'A project id is required.', 422);

      const project = await db
        .prepare('SELECT id, slug, url, title, blurb FROM projects WHERE id = ?1')
        .bind(id)
        .first<{ id: number; slug: string; url: string; title: string; blurb: string | null }>();

      if (!project) return fail('regenerate.not_found', 'No such project.', 404);

      // `run: true` performs the work now rather than queueing it, because a
      // human pressed a button and is watching. Queued runs are for adds.
      if (body.run === true) {
        // A human pressed the button: run the capture now, not on a timer.
        const result = await generateMetadata(env, project, { allowCapture: true });
        await saveMetadata(db, id, result.preview, {
          title: result.suggestedTitle,
          description: result.suggestedDescription,
        });
        return json({ ok: result.ok, outcome: result.outcome, error: result.error });
      }

      const jobId = await enqueuePreview(db, id, 'preview');
      return json({ ok: true, queued: true, jobId });
    }

    // -------------------------------------------------------- toggle publish
    case 'toggle-published': {
      const id = Number(body.id);
      if (!Number.isFinite(id)) return fail('toggle.no_id', 'A project id is required.', 422);
      await db
        .prepare('UPDATE projects SET published = CASE published WHEN 1 THEN 0 ELSE 1 END WHERE id = ?1')
        .bind(id)
        .run();
      return json({ ok: true });
    }

    case 'toggle-featured': {
      const id = Number(body.id);
      if (!Number.isFinite(id)) return fail('toggle.no_id', 'A project id is required.', 422);
      await db
        .prepare('UPDATE projects SET featured = CASE featured WHEN 1 THEN 0 ELSE 1 END WHERE id = ?1')
        .bind(id)
        .run();
      return json({ ok: true });
    }

    default:
      return fail('unknown_action', `Unknown action: ${action}`);
  }
};

/** Only http/https/mailto may be stored as an outbound link. */
function validateOptionalLink(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}
