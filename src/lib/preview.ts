/**
 * Preview resolution: turns a possibly-empty Preview into something that always
 * renders.
 *
 * The four tiers, in the order they are preferred:
 *   1. live      — iframe, only when the site permits framing AND the host is
 *                  on the framable allowlist. Never used on mobile by default.
 *   2. screenshot — our own capture in R2. The normal case.
 *   3. og        — the page's own social image, hot-linked and resized by us.
 *   4. favicon   — last resort, or a designed typographic plate.
 *
 * The invariant: `imageUrl` is never empty and `background` is always a colour,
 * so a card cannot render as a broken image or an unstyled void — including
 * when every external service is down.
 */

import { media, studio } from '~/config/site';
import type { Preview, Product, Project, ResolvedPreview } from './types';

/**
 * Product lifecycle labels. Written out rather than derived, because the whole
 * point is that the status is a plain statement of fact — "In development"
 * reads as a deliberate disclosure, "WIP" or a progress bar does not.
 */
export const PRODUCT_STATUS_LABELS: Record<string, string> = {
  planning: 'Planned',
  'in-development': 'In development',
  beta: 'Beta',
  live: 'Live',
  paused: 'Paused',
  retired: 'Retired',
};

/** Card media widths we generate. AVIF only from 768 up; see lib/images. */
export const CARD_WIDTHS = [480, 768, 1200, 1600] as const;

const FALLBACK_BG = '#e4e9f4';

/** True when this host is allowed to be iframed by the site. */
export function isFramableHost(url: string, allowlist: readonly string[] = media.framableHosts): boolean {
  if (!allowlist.length) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowlist.some((entry) => {
    const e = entry.trim().toLowerCase().replace(/^\*\./, '');
    return e && (host === e || host.endsWith(`.${e}`));
  });
}

/**
 * Chooses a surface that is neutral and light enough that any screenshot reads
 * well on it, but tinted enough to avoid a dead grey void before paint.
 */
function safeBackground(candidate: string | undefined): string {
  if (!candidate) return FALLBACK_BG;
  const hex = candidate.trim();
  if (!/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(hex) && !/^#[0-9a-f]{6}$/i.test(hex)) {
    return FALLBACK_BG;
  }
  return hex;
}

/*
 * Media origin resolution.
 *
 * `MEDIA_BASE_URL` is a deployment concern (change the bucket domain without a
 * rebuild) and `media.baseUrl` in src/config/site.ts is the source-controlled
 * default. Previously the env var was declared and documented but never read,
 * so changing it in production did nothing.
 *
 * Initialised once per request by the middleware, which is the only place that
 * has already resolved the environment. Every read site is synchronous, which
 * keeps `resolvePreview` a pure function and testable with no env at all.
 */
let mediaBase = media.baseUrl;

export function setMediaBaseUrl(base: string | undefined): void {
  if (base && /^https?:\/\//i.test(base)) mediaBase = base;
}

export function getMediaBaseUrl(): string {
  return mediaBase;
}

function mediaUrl(key: string): string {
  const base = mediaBase.replace(/\/+$/, '');
  const clean = key.replace(/^\/+/, '');
  return `${base}/${clean}`;
}

/** Builds a srcset from the R2 keys written by the capture pipeline. */
function buildSrcset(keys: readonly string[] | undefined): string | undefined {
  if (!keys?.length) return undefined;
  const parts = keys
    .map((key, i) => `${mediaUrl(key)} ${CARD_WIDTHS[i] ?? CARD_WIDTHS[CARD_WIDTHS.length - 1]}w`)
    .filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

export interface ResolveOptions {
  /**
   * Whether a live iframe may be used. False on mobile by default: an iframe
   * pulls a whole second document over a metered connection, and the poster is
   * a strictly better first paint.
   */
  allowLive?: boolean;
  /** Overrides the framable allowlist (used by tests). */
  framableHosts?: readonly string[];
}

/**
 * Produces the final render descriptor for a project card.
 */
export function resolvePreview(
  preview: Preview | null | undefined,
  projectUrl: string,
  options: ResolveOptions = {},
): ResolvedPreview {
  const p: Preview = preview ?? {};
  const background = safeBackground(p.dominant);

  const liveAllowed =
    options.allowLive === true &&
    p.frameable === true &&
    isFramableHost(projectUrl, options.framableHosts ?? media.framableHosts);

  // ---- Tier 2/3/4: pick the still image -------------------------------
  let imageUrl = '';
  let srcset: string | undefined;
  let source: ResolvedPreview['source'] = 'placeholder';
  let width = p.width;
  let height = p.height;

  if (p.thumb) {
    imageUrl = mediaUrl(p.thumb);
    srcset = buildSrcset(p.thumbSrcset);
    source = 'screenshot';
  } else if (p.poster) {
    // A video exists but its dedicated thumbnail does not. Use the poster.
    imageUrl = mediaUrl(p.poster);
    source = 'video';
  } else if (p.og) {
    imageUrl = p.og;
    source = 'og';
  } else if (p.favicon) {
    imageUrl = p.favicon;
    source = 'favicon';
  } else {
    // Nothing external works. A designed plate, drawn inline, not a broken img.
    imageUrl = '';
    source = 'placeholder';
  }

  return {
    imageUrl,
    srcset,
    background,
    videoUrl: p.video ? mediaUrl(p.video) : undefined,
    videoPoster: p.poster ? mediaUrl(p.poster) : undefined,
    live: liveAllowed,
    liveUrl: projectUrl,
    source,
    width,
    height,
  };
}

/** Convenience for the project card. */
export function resolveProjectPreview(
  project: Pick<Project, 'url' | 'preview'>,
  options: ResolveOptions = {},
): ResolvedPreview {
  return resolvePreview(project.preview, project.url, options);
}

/**
 * Convenience for the product card.
 *
 * A product may have an availability link (a waitlist, a store, a beta invite)
 * that differs from its canonical URL. Framing and hot-linking always resolve
 * against the canonical URL, never the availability link.
 */
export function resolveProductPreview(
  product: Pick<Product, 'url' | 'preview'>,
  options: ResolveOptions = {},
): ResolvedPreview {
  return resolvePreview(product.preview, product.url, { allowLive: false, ...options });
}

/** Aspect ratio clamped to something that cannot break the grid. */
export function safeAspectRatio(ratio: number | null | undefined): number {
  if (!ratio || !Number.isFinite(ratio)) return 1.6;
  return Math.min(Math.max(ratio, 0.6), 2.4);
}

/**
 * The fixed set of media ratios the CSS knows about.
 *
 * Cards select one with a data attribute rather than an inline custom
 * property, because the CSP does not permit style attributes and hashing
 * every ratio would cost more than the rules are worth. A project whose real
 * ratio is 1.71 renders at 1.777; that is imperceptible and it keeps the
 * stylesheet small enough to inline.
 */
export const AR_BUCKETS = [
  { name: '4-3', value: 4 / 3 },
  { name: '3-2', value: 3 / 2 },
  { name: '16-9', value: 16 / 9 },
  { name: '1-1', value: 1 },
  { name: '4-5', value: 4 / 5 },
  { name: '3-4', value: 3 / 4 },
] as const;

/**
 * Picks the CSS bucket nearest a given ratio.
 *
 * Non-finite input (a missing or unparseable form field) falls back to 16:9 —
 * the column default — rather than silently resolving to whatever the reduce
 * seed happens to be. That bug produced 3:2 for every project created through
 * the API without an explicit ratio.
 */
export function arBucketFor(ratio: number | null | undefined): (typeof AR_BUCKETS)[number] {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) {
    return AR_BUCKETS.find((b) => b.name === '16-9')!;
  }
  return AR_BUCKETS.reduce((best, bucket) =>
    Math.abs(bucket.value - ratio) < Math.abs(best.value - ratio) ? bucket : best,
  AR_BUCKETS[0]);
}

/** Small label describing where a card's image came from. */
export function previewSourceLabel(source: ResolvedPreview['source']): string {
  switch (source) {
    case 'screenshot':
      return 'Captured';
    case 'video':
      return 'Preview';
    case 'og':
      return 'Site image';
    case 'favicon':
      return 'Icon';
    default:
      return 'No preview yet';
  }
}

/** Hosts we are willing to hot-link an og:image from. */
export function isHotlinkable(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (u.port && u.port !== '80' && u.port !== '443') return false;
    return true;
  } catch {
    return false;
  }
}
