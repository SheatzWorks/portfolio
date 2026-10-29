/**
 * Studio identity — the one file with the studio's voice in it.
 *
 * Rules this file follows
 * -----------------------
 *  * The studio is an entity. There are no personal names, roles, bios or
 *    portraits anywhere, by decision. Everything on the site speaks as `sheatz`.
 *  * Nothing here is invented. No client names, no metrics, no testimonials,
 *    no years of experience, no award claims. Where a real fact is missing it
 *    is absent, not approximated.
 *  * The remaining PLACEHOLDER values are checked by scripts/build.mjs, which
 *    fails the build if any of them would reach a public page's body copy.
 */

/** Social / contact destinations. PLACEHOLDER until the real ones exist. */
export interface SocialLink {
  label: string;
  href: string;
  handle?: string;
}

export interface StudioConfig {
  /**
   * Lowercase, no title case. `sheatz` is a mark, not a word, and the
   * lowercasing is deliberate.
   */
  name: string;

  /**
   * One line. States what is built, not what is felt.
   */
  tagline: string;

  /** Used for meta descriptions and structured data. */
  description: string;

  /**
   * The hero. Chosen over a capability statement because the products
   * demonstrate the capability faster than a sentence can.
   */
  hero: {
    /** One line, capabilities only. The lede below carries the in-house claim. */
    eyebrow: string;
    heading: string;
    lede: string;
    /** Two actions, maximum. A third dilutes both. */
    primary: { label: string; href: string };
    secondary: { label: string; href: string };
  };

  /**
   * The line that closes the page. Dry on purpose: the humour is what makes
   * the assurance land instead of sounding like a disclaimer.
   */
  closing: string;

  email: string;
  location: string;
  social: readonly SocialLink[];
  /** ISO 4217 code for the published price ranges. */
  priceCurrency: string;
  siteUrl: string;
}

export const studio: StudioConfig = {
  name: 'sheatz',

  tagline: 'Web applications, mobile apps and on-device AI — designed, built and run in-house.',

  description:
    'sheatz is a small studio with no sales team. We design, build and operate web applications, mobile apps and products that run AI on the device — then we stay on after launch.',

  hero: {
    eyebrow: 'Web applications · Mobile · On-device AI',
    heading: 'We build our own software. And yours, the same way.',
    lede: 'Everything here was designed, built and operated in-house — so the person answering you is the person building it.',
    primary: { label: 'See what we run', href: '/products' },
    secondary: { label: 'Start a project', href: '/contact' },
  },

  closing: 'We do our best. It is the only tier we have.',

  // PLACEHOLDER — no real domain or mailbox yet. Both are printed at the top
  // of every build until they are replaced.
  email: 'hello@example.com',
  location: 'Remote',
  siteUrl: 'https://example.com',

  /**
   * Currency for the published service ranges.
   *
   * A bare "30,000 – 75,000" is ambiguous, and a range that cannot be read is
   * not a filter. GBP is an assumption: confirm it before launch and change it
   * here, in one place, and every range and every JSON-LD Offer follows.
   */
  priceCurrency: 'GBP',

  social: [
    { label: 'Instagram', href: 'https://instagram.com/PLACEHOLDER', handle: '@PLACEHOLDER' },
    { label: 'GitHub', href: 'https://github.com/PLACEHOLDER' },
    { label: 'LinkedIn', href: 'https://linkedin.com/in/PLACEHOLDER' },
  ],
};

/**
 * Media origin for generated screenshots and preview video.
 *
 * Reads from `MEDIA_BASE_URL` at request time (see lib/preview.ts) and falls
 * back to this. Kept here so a development machine works with no configuration
 * at all.
 */
export const media = {
  baseUrl: 'https://media.example.com',

  /**
   * Hosts permitted to be rendered inside an <iframe> as a live preview.
   *
   * EMPTY on purpose. An empty list means no third-party page is ever framed
   * inside the studio's own — see docs/security.md. Opt in per host.
   */
  framableHosts: [] as readonly string[],
};

export function absoluteUrl(path = '/'): string {
  const base = studio.siteUrl.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/** True while any identity placeholder is still unresolved. */
export function hasPlaceholders(): boolean {
  return (
    studio.email === 'hello@example.com' ||
    studio.siteUrl === 'https://example.com' ||
    studio.social.some((s) => s.href.includes('PLACEHOLDER'))
  );
}

/**
 * Social links that are safe to publish.
 *
 * The single source of truth for what may be rendered, so no call site can
 * forget the check. This exists because the unresolved placeholders shipped
 * publicly on every page — in the footer, in the contact page and inside the
 * JSON-LD — while `hasPlaceholders()` only fed a build warning nobody read.
 *
 * An unresolved link is *absent*, not rendered as a placeholder. A link to
 * nowhere is worse than no link.
 */
export function publishableSocial(): SocialLink[] {
  return studio.social.filter(
    (link) =>
      !/PLACEHOLDER|example\.(com|org|net)/i.test(link.href) &&
      (link.handle === undefined || !/PLACEHOLDER/i.test(link.handle)),
  );
}
