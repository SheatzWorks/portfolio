/**
 * D1 access layer.
 *
 * Every row is converted to a typed object here and nowhere else, so a schema
 * change has exactly one blast radius. All JSON columns are parsed through
 * `parseJson`, which fails soft to a safe default rather than throwing — a
 * single malformed row must never take down the whole creations index.
 */

import type {
  CapabilityGroup,
  FaqEntry,
  GalleryImage,
  InstagramPost,
  Metric,
  Preview,
  ProcessPhase,
  Project,
  ProjectKind,
  ProjectLinkSet,
  ProjectStatus,
  PreviewState,
  Service,
  TeamMember,
  Testimonial,
} from './types';

/**
 * Minimal shape of the D1 binding, so tests can pass a stub.
 *
 * Mirrors the real `D1PreparedStatement` closely enough that a stub is
 * structurally compatible, and loose enough that tests do not have to implement
 * `raw()`.
 */
export interface D1Like {
  prepare(query: string, ...bindings: unknown[]): D1StatementLike;
  batch?: (statements: D1PreparedStatementLike[]) => Promise<unknown>;
}

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run<T = Record<string, unknown>>(): Promise<{ meta?: { changes?: number; last_row_id?: number } } & T>;
}

/** The subset `db.batch()` needs. */
export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function toBool(v: unknown): boolean {
  return v === 1 || v === true || v === '1';
}

function toStrArray(v: unknown): string[] {
  const arr = parseJson<unknown>(v, []);
  return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
}

function rowToProject(r: Record<string, unknown>): Project {
  return {
    id: Number(r.id),
    slug: String(r.slug),
    title: String(r.title),
    url: String(r.url),
    blurb: r.blurb == null ? null : String(r.blurb),
    summary: r.summary == null ? null : String(r.summary),
    category: String(r.category ?? 'web'),
    technologies: toStrArray(r.technologies),
    year: r.year == null ? null : Number(r.year),
    status: String(r.status ?? 'live') as ProjectStatus,
    kind: String(r.kind ?? 'web') as ProjectKind,
    featured: toBool(r.featured),
    sortOrder: Number(r.sort_order ?? 0),
    published: toBool(r.published),
    hasCaseStudy: toBool(r.has_case_study),
    bodyMd: r.body_md == null ? null : String(r.body_md),
    challengeMd: r.challenge_md == null ? null : String(r.challenge_md),
    approachMd: r.approach_md == null ? null : String(r.approach_md),
    outcomeMd: r.outcome_md == null ? null : String(r.outcome_md),
    credits: parseJson(r.credits, [] as Project['credits']),
    links: parseJson<ProjectLinkSet>(r.links, {}),
    metrics: r.metrics ? parseJson<Metric[] | null>(r.metrics, null) : null,
    gallery: parseJson<GalleryImage[]>(r.gallery, []),
    aspectRatio: Number(r.aspect_ratio ?? 1.6),
    preview: parseJson<Preview>(r.preview, {}),
    previewState: String(r.preview_state ?? 'queued') as PreviewState,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

const PROJECT_COLUMNS = `id, slug, title, url, blurb, summary, category, technologies,
  year, status, kind, featured, sort_order, published, has_case_study, body_md,
  challenge_md, approach_md, outcome_md, credits, links, metrics, gallery,
  aspect_ratio, preview, preview_state, created_at, updated_at`;

/**
 * Projects visible to the public.
 *
 * `status` is part of this filter, not decoration: a project marked `private`
 * or `archived` must not appear in the index, resolve at its slug, or reach the
 * sitemap. It is listed here alongside `published` because both are visibility
 * decisions and it is easy to set one and forget the other.
 */
const PUBLIC_WHERE = `published = 1 AND status NOT IN ('private', 'archived')`;

export async function listPublishedProjects(db: D1Like): Promise<Project[]> {
  const { results } = await db
    .prepare(
      `SELECT ${PROJECT_COLUMNS} FROM projects WHERE ${PUBLIC_WHERE}
        ORDER BY sort_order ASC, year DESC, id DESC`,
    )
    .bind()
    .all<Record<string, unknown>>();
  return results.map(rowToProject);
}

/** Every project including drafts, for the admin surface. */
export async function listAllProjects(db: D1Like): Promise<Project[]> {
  const { results } = await db
    .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY sort_order ASC, id DESC`)
    .bind()
    .all<Record<string, unknown>>();
  return results.map(rowToProject);
}

export async function getProjectBySlug(db: D1Like, slug: string): Promise<Project | null> {
  const row = await db
    .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE slug = ?1 LIMIT 1`)
    .bind(slug)
    .first<Record<string, unknown>>();
  return row ? rowToProject(row) : null;
}

export async function getProjectById(db: D1Like, id: number): Promise<Project | null> {
  const row = await db
    .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?1 LIMIT 1`)
    .bind(id)
    .first<Record<string, unknown>>();
  return row ? rowToProject(row) : null;
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export async function listTeam(db: D1Like): Promise<TeamMember[]> {
  const { results } = await db
    .prepare(
      `SELECT id, slug, name, role, bio, focus, links, sort_order
       FROM team WHERE published = 1 ORDER BY sort_order ASC`,
    )
    .bind()
    .all<Record<string, unknown>>();

  return results.map((r) => ({
    id: Number(r.id),
    slug: String(r.slug),
    name: String(r.name),
    role: String(r.role),
    bio: r.bio == null ? null : String(r.bio),
    focus: toStrArray(r.focus),
    links: parseJson<{ label: string; href: string }[]>(r.links, []),
    sortOrder: Number(r.sort_order ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// Testimonials — empty until there are real ones. Never fabricated.
// ---------------------------------------------------------------------------

export async function listTestimonials(db: D1Like): Promise<Testimonial[]> {
  const { results } = await db
    .prepare(
      `SELECT id, quote, author, role, company, source_url
       FROM testimonials WHERE published = 1 ORDER BY sort_order ASC`,
    )
    .bind()
    .all<Record<string, unknown>>();

  return results.map((r) => ({
    id: Number(r.id),
    quote: String(r.quote),
    author: String(r.author),
    role: r.role == null ? null : String(r.role),
    company: r.company == null ? null : String(r.company),
    sourceUrl: r.source_url == null ? null : String(r.source_url),
  }));
}

// ---------------------------------------------------------------------------
// Instagram — studio-owned screenshots, no embed, no third-party JS.
// ---------------------------------------------------------------------------

export async function listInstagramPosts(db: D1Like): Promise<InstagramPost[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.permalink, p.image_key, p.caption, p.posted_at, pr.slug AS project_slug
       FROM instagram_posts p
       LEFT JOIN projects pr ON pr.id = p.project_id
       WHERE p.published = 1
       ORDER BY p.sort_order ASC, p.posted_at DESC`,
    )
    .bind()
    .all<Record<string, unknown>>();

  return results.map((r) => ({
    id: Number(r.id),
    permalink: String(r.permalink),
    imageUrl: r.image_key ? String(r.image_key) : null,
    caption: r.caption == null ? null : String(r.caption),
    postedAt: r.posted_at == null ? null : String(r.posted_at),
    projectSlug: r.project_slug == null ? null : String(r.project_slug),
  }));
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export async function listServices(db: D1Like): Promise<Service[]> {
  const { results } = await db
    .prepare(
      `SELECT id, slug, name, outcome, deliverables FROM services
       WHERE published = 1 ORDER BY sort_order ASC`,
    )
    .bind()
    .all<Record<string, unknown>>();

  return results.map((r) => ({
    id: Number(r.id),
    slug: String(r.slug),
    name: String(r.name),
    outcome: String(r.outcome),
    deliverables: toStrArray(r.deliverables),
  }));
}

// ---------------------------------------------------------------------------
// Singleton editorial content
// ---------------------------------------------------------------------------

export interface SiteContent {
  faq: FaqEntry[];
  capabilities: CapabilityGroup[];
  process: ProcessPhase[];
  servicesIntro: string | null;
  contactBlurb: string | null;
}

export async function getSiteContent(db: D1Like): Promise<SiteContent> {
  const row = await db
    .prepare('SELECT faq, capabilities, process, services_intro, contact_blurb FROM site_content WHERE id = 1')
    .bind()
    .first<Record<string, unknown>>();

  if (!row) {
    return { faq: [], capabilities: [], process: [], servicesIntro: null, contactBlurb: null };
  }

  return {
    faq: parseJson<FaqEntry[]>(row.faq, []),
    capabilities: parseJson<CapabilityGroup[]>(row.capabilities, []),
    process: parseJson<ProcessPhase[]>(row.process, []),
    servicesIntro: row.services_intro == null ? null : String(row.services_intro),
    contactBlurb: row.contact_blurb == null ? null : String(row.contact_blurb),
  };
}
