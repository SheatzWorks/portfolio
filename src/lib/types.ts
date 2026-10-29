/** Shared domain types. Mirrors the D1 schema; nothing in the app casts. */

/**
 * Who owns the work.
 *
 * 'own' means sheatz designed, built and operates it. 'client' means it was
 * commissioned. This is the only honest way to present the difference between
 * a product and a piece of client work, and it drives the /products and /work
 * split.
 */
export type Ownership = 'client' | 'own';

/**
 * Product lifecycle. 'planning' exists so unfinished work can be listed
 * honestly — better than hiding it or claiming more than is true.
 */
export type ProductStatus =
  | 'planning'
  | 'in-development'
  | 'beta'
  | 'live'
  | 'paused'
  | 'retired';

export type ProjectKind =
  | 'web'
  | 'webapp'
  | 'mobile'
  | 'saas'
  | 'ai'
  | 'experiment'
  | 'client'
  | 'internal';

export type ProjectStatus =
  | 'live'
  | 'in-progress'
  | 'archived'
  | 'private'
  | 'experiment';

export type PreviewState =
  | 'queued'
  | 'metadata'
  | 'capturing'
  | 'ready'
  | 'partial'
  | 'failed';

export type PreviewSource = 'screenshot' | 'video' | 'og' | 'favicon' | 'placeholder';

/** Written by the capture pipeline. Every field is optional by design: a
 *  preview must degrade, never fail. See `resolvePreview()` for the fallback
 *  chain that turns this into something always renderable. */
export interface Preview {
  /** R2 key of the primary card image (AVIF/WebP), resolved via media base. */
  thumb?: string;
  /** R2 keys for responsive variants, e.g. ['card-480','card-960'] */
  thumbSrcset?: string[];
  /** R2 key of the video poster frame. */
  poster?: string;
  /** R2 key of the preview MP4. */
  video?: string;
  /** Externally hosted og:image, used when no screenshot was produced. */
  og?: string;
  /** Externally hosted favicon, the last-resort image. */
  favicon?: string;
  /** Dominant colour as #rrggbb, used as the card background before paint. */
  dominant?: string;
  width?: number;
  height?: number;
  /** Whether the live site permits framing, probed server-side at capture. */
  frameable?: boolean;
  /** ISO date of the last successful capture, for cache invalidation. */
  checkedAt?: string;
  /** Which tier actually produced the visible asset. */
  source?: PreviewSource;
  /** Human-readable reason a tier was skipped, surfaced in the admin only. */
  note?: string;
}

export interface ProjectLinkSet {
  github?: string;
  instagram?: string;
  caseStudy?: string;
  store?: string;
  demo?: string;
}

export interface Credit {
  role: string;
  name: string;
  href?: string;
}

export interface Metric {
  label: string;
  value: string;
  note?: string;
}

export interface GalleryImage {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption?: string;
}

export interface Project {
  id: number;
  slug: string;
  title: string;
  url: string;
  blurb: string | null;
  summary: string | null;
  category: string;
  technologies: string[];
  year: number | null;
  status: ProjectStatus;
  kind: ProjectKind;
  featured: boolean;
  sortOrder: number;
  published: boolean;
  hasCaseStudy: boolean;
  /** Discriminator for /work vs /products. */
  ownership: Ownership;
  productStatus: ProductStatus | null;
  availabilityUrl: string | null;
  tagline: string | null;
  bodyMd: string | null;
  /* The narrative arc. Every field is rendered by the case study and writable
     from the admin — the previous migration shipped these columns with no code
     path able to write them, which made the strongest template unreachable. */
  objectiveMd: string | null;
  challengeMd: string | null;
  approachMd: string | null;
  designMd: string | null;
  engineeringMd: string | null;
  outcomeMd: string | null;
  challengesMd: string | null;
  lessonsMd: string | null;
  credits: Credit[];
  links: ProjectLinkSet;
  metrics: Metric[] | null;
  gallery: GalleryImage[];
  aspectRatio: number;
  preview: Preview;
  previewState: PreviewState;
  createdAt: string;
  updatedAt: string;
}

/** What a client should see once the fallback chain has run. */
export interface ResolvedPreview {
  /** Final image URL, always non-empty — the card can never be blank. */
  imageUrl: string;
  /** Optional responsive srcset. */
  srcset?: string;
  /** Background colour painted before the image decodes. */
  background: string;
  /** Video URL, when a preview recording exists. */
  videoUrl?: string;
  /** Poster frame for the video. */
  videoPoster?: string;
  /** True only when the live site allows framing AND the host is allowlisted. */
  live: boolean;
  /** The target to iframe. */
  liveUrl: string;
  /** Which tier won. Drives the small status label on the card. */
  source: PreviewSource;
  /** Intrinsic size when known, so the card can reserve space (no CLS). */
  width?: number;
  height?: number;
}

export interface TeamMember {
  id: number;
  slug: string;
  name: string;
  role: string;
  bio: string | null;
  focus: string[];
  links: { label: string; href: string }[];
  sortOrder: number;
}

export interface Testimonial {
  id: number;
  quote: string;
  author: string;
  role: string | null;
  company: string | null;
  sourceUrl: string | null;
}

export interface InstagramPost {
  id: number;
  permalink: string;
  imageUrl: string | null;
  caption: string | null;
  postedAt: string | null;
  projectSlug: string | null;
}

export interface Service {
  id: number;
  slug: string;
  name: string;
  outcome: string;
  deliverables: string[];
  /** Published price range. A filter for both sides, not a promotion. */
  priceFrom: string | null;
  priceTo: string | null;
  priceNote: string | null;
  /** e.g. "Fixed scope" or "Ongoing". */
  engagement: string | null;
  /** Signature services are listed first on /services. */
  isSignature: boolean;
}

/** A project sheatz owns and operates, as rendered on /products. */
export type Product = Project & { ownership: 'own' };

export interface Differentiator {
  id: number;
  label: string;
  body: string;
  sortOrder: number;
}

export interface FaqEntry {
  question: string;
  answer: string;
}

export interface CapabilityGroup {
  group: string;
  items: string[];
}

export interface ProcessPhase {
  phase: string;
  detail: string;
}
