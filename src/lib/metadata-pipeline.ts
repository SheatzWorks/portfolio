/**
 * Metadata pipeline — the part that runs inside the Cloudflare Worker.
 *
 * Scope is deliberately narrow, because the Worker runtime cannot do two things
 * this system needs:
 *
 *   - `sharp` is a native Node module and cannot load in a Worker isolate
 *   - there is no Chromium, so no page can be rendered in-process
 *
 * So the Worker does what it *can* do cheaply and safely — validate the URL,
 * read the page's own metadata — and the capture worker
 * (src/capture/worker.ts, run on Node) does the browser and the image work.
 * The two meet at the `preview` JSON column on each project row.
 *
 * Everything in this module is Worker-safe: no native imports, and cheerio is
 * pure JS over parse5.
 */

import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { Env } from './env';
import { parseHostAllowlist } from './env';
import { safeFetch, UnsafeUrlError, isChallenge } from './safe-fetch';
import { extractMeta, deriveTitle } from './metadata';
import { isHotlinkable } from './preview';
import { selectProvider, type CaptureProvider } from './capture';
import type { Preview } from './types';

export type MetadataOutcome =
  | 'captured'
  | 'metadata'
  | 'og-only'
  | 'challenge'
  | 'failed'
  | 'skipped';

export interface MetadataResult {
  ok: boolean;
  preview: Preview;
  outcome: MetadataOutcome;
  error?: string;
  suggestedTitle?: string;
  suggestedDescription?: string;
}

/**
 * Fetches a project page through the SSRF guard and extracts its metadata.
 * Never throws — the outcome is always in the result.
 */
export async function generateMetadata(
  env: Env,
  project: { id: number; slug: string; url: string; title: string },
  options: { provider?: CaptureProvider; allowCapture?: boolean } = {},
): Promise<MetadataResult> {
  const preview: Preview = {};

  if (env.PREVIEW_FETCH_MODE === 'disabled') {
    return {
      ok: false,
      preview: { note: 'PREVIEW_FETCH_MODE=disabled' },
      outcome: 'skipped',
      error: 'Outbound fetching is disabled on this deployment.',
    };
  }

  const allowlist = parseHostAllowlist(env.ALLOWED_CAPTURE_HOSTS);

  /*
   * Hosted capture, when configured.
   *
   * A Worker cannot render a page itself — there is no Chromium — but it CAN
   * call a hosted capture service over HTTP. That is the whole point of the
   * free tier: no VM, no browser to keep warm, and the rendering happens inside
   * the provider's network rather than ours.
   *
   * The provider is asked for WebP at a fixed width, because there is no sharp
   * in a Worker to derive a responsive set. That is materially better than no
   * screenshot, and the capture script can later replace it with a full
   * srcset without the site changing at all.
   */
  const provider = options.provider ?? selectProvider(env);
  if (provider.isConfigured() && options.allowCapture !== false) {
    const captured = await tryCapture(env, project, provider);
    if (captured) return captured;
  }

  try {
    const response = await safeFetch(project.url, {
      allowlist,
      maxBytes: 2 * 1024 * 1024,
      timeoutMs: 10_000,
    });

    const checkedAt = new Date().toISOString();

    if (isChallenge(response)) {
      return {
        ok: false,
        preview: { checkedAt, note: `bot challenge (${response.status})` },
        outcome: 'challenge',
        error: 'The site is behind a bot challenge and could not be read.',
      };
    }

    if (response.status >= 400) {
      return {
        ok: false,
        preview: { checkedAt, note: `http ${response.status}` },
        outcome: 'failed',
        error: `The site returned HTTP ${response.status}.`,
      };
    }

    const meta = extractMeta(response.body, response.finalUrl);

    // Only keep images we are genuinely able to load.
    if (meta.image && isHotlinkable(meta.image)) preview.og = meta.image;
    if (meta.favicon && isHotlinkable(meta.favicon)) preview.favicon = meta.favicon;

    preview.checkedAt = checkedAt;

    const source = preview.og ? 'og' : preview.favicon ? 'favicon' : 'placeholder';
    preview.source = source;

    return {
      ok: true,
      preview,
      outcome: preview.og ? 'og-only' : 'metadata',
      suggestedTitle: deriveTitle(meta, project.url, project.title),
      suggestedDescription: meta.description ?? undefined,
    };
  } catch (err) {
    const code = err instanceof UnsafeUrlError ? err.code : 'network';
    return {
      ok: false,
      preview: { checkedAt: new Date().toISOString(), note: code },
      outcome: 'failed',
      error: err instanceof Error ? err.message : 'The site could not be reached.',
    };
  }
}

/**
 * Attempts a hosted capture and uploads the result.
 * Returns null when the provider is unavailable, so the caller falls through
 * to the metadata tiers.
 */
async function tryCapture(
  env: Env,
  project: { id: number; slug: string; url: string; title: string },
  provider: CaptureProvider,
): Promise<MetadataResult | null> {
  try {
    const result = await provider.capture({ url: project.url, width: 1200, scale: 1 });

    // Only store what is genuinely an image. A challenge page or an error body
    // arriving as HTML must not become the card's picture.
    if (!result.contentType.startsWith('image/')) return null;

    const key = `projects/${project.slug}/card-1200.webp`;
    if (env.MEDIA) {
      await env.MEDIA.put(key, result.body, {
        httpMetadata: {
          contentType: result.contentType,
          cacheControl: 'public, max-age=31536000, immutable',
        },
      });
    }

    const preview: Preview = {
      thumb: key,
      thumbSrcset: [key],
      source: 'screenshot',
      width: 1200,
      height: Math.round((1200 * 9) / 16),
      checkedAt: new Date().toISOString(),
    };

    return { ok: true, preview, outcome: 'captured' };
  } catch (err) {
    // A failed capture is not a failure: the caller continues to the metadata
    // tiers, which is the whole point of the fallback chain.
    console.warn(
      JSON.stringify({
        event: 'capture.failed',
        provider: provider.name,
        project: project.slug,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return null;
  }
}

/** Persists a preview descriptor without clobbering a screenshot already there. */
export async function saveMetadata(
  db: D1Database,
  projectId: number,
  incoming: Preview,
  suggestions?: { title?: string; description?: string },
): Promise<void> {
  /*
   * Merge, do not replace.
   *
   * The metadata pass only learns about {og, favicon, checkedAt}. It
   * knows nothing about a screenshot that a previous capture produced. Writing
   * its result wholesale erased `thumb` from the descriptor, so pressing
   * Re-capture on a project that already had one visibly regressed the card to
   * the og/favicon tier — even though the R2 object was still there.
   *
   * Only metadata-owned fields are written back; thumb/poster/video/dimensions
   * from an existing capture are preserved.
   */
  const row = await db
    .prepare('SELECT preview FROM projects WHERE id = ?1')
    .bind(projectId)
    .first<{ preview: string | null }>();

  let existing: Preview = {};
  try {
    existing = row?.preview ? (JSON.parse(row.preview) as Preview) : {};
  } catch {
    existing = {};
  }

  const preview: Preview = {
    ...existing,
    og: incoming.og ?? existing.og,
    favicon: incoming.favicon ?? existing.favicon,
    checkedAt: incoming.checkedAt ?? existing.checkedAt,
    note: incoming.note ?? existing.note,
  };

  // The source label must reflect the BEST tier available, not the last pass.
  const best: Preview['source'] = preview.thumb
    ? 'screenshot'
    : preview.video
      ? 'video'
      : preview.og
        ? 'og'
        : preview.favicon
          ? 'favicon'
          : 'placeholder';
  preview.source = best;

  const hasImage = Boolean(preview.thumb || preview.og || preview.favicon);
  const state = preview.thumb ? 'ready' : hasImage ? 'partial' : 'failed';

  await db
    .prepare(
      `UPDATE projects
         SET preview = ?1,
             preview_state = ?2,
             -- Never overwrite a captured screenshot with a weaker tier, and
             -- never overwrite copy a human wrote.
             title  = CASE WHEN title  = '' THEN COALESCE(?3, title)  ELSE title  END,
             blurb  = CASE WHEN blurb IS NULL THEN COALESCE(?4, blurb) ELSE blurb END
       WHERE id = ?5`,
    )
    .bind(
      JSON.stringify(preview),
      state,
      suggestions?.title ?? null,
      suggestions?.description ?? null,
      projectId,
    )
    .run();
}

/**
 * Uploads a raw capture and merges the derived variants into the descriptor.
 * Called by the capture worker once it has done the image work in Node.
 */
export async function recordCapture(
  db: D1Database,
  media: R2Bucket | undefined,
  project: { id: number; slug: string },
  assets: {
    variants: { key: string; body: Uint8Array; contentType: string }[];
    poster?: { key: string; body: Uint8Array; contentType: string };
    dominant?: string | null;
    width: number;
    height: number;
    video?: { key: string; body: Uint8Array; contentType: string };
  },
): Promise<Preview> {
  const prefix = `projects/${project.slug}`;
  const CACHE = 'public, max-age=31536000, immutable';

  const all = [...assets.variants, ...(assets.poster ? [assets.poster] : [])];
  if (media && all.length) {
    await Promise.all(
      all.map((asset) =>
        media!.put(asset.key, asset.body, {
          httpMetadata: { contentType: asset.contentType, cacheControl: CACHE },
        }),
      ),
    );
  }

  const primary =
    assets.variants.find((v) => v.key.endsWith('card-768.webp')) ?? assets.variants[0];

  const current = await db
    .prepare('SELECT preview FROM projects WHERE id = ?1')
    .bind(project.id)
    .first<{ preview: string }>();

  let existing: Preview = {};
  try {
    existing = current?.preview ? (JSON.parse(current.preview) as Preview) : {};
  } catch {
    existing = {};
  }

  const next: Preview = {
    ...existing,
    thumb: primary?.key,
    thumbSrcset: assets.variants.filter((v) => v.key.endsWith('.webp')).map((v) => v.key),
    dominant: assets.dominant ?? existing.dominant,
    width: assets.width,
    height: assets.height,
    source: 'screenshot',
    checkedAt: new Date().toISOString(),
    note: undefined,
  };
  if (assets.poster) next.poster = assets.poster.key;
  if (assets.video) next.video = assets.video.key;

  await db
    .prepare('UPDATE projects SET preview = ?1, preview_state = ?2 WHERE id = ?3')
    .bind(JSON.stringify(next), 'ready', project.id)
    .run();

  return next;
}
