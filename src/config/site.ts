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

  /*
   * The studio mailbox. This is the real address now, so it is published: the
   * contact page renders it as a link and the contact API falls back to it as
   * the destination when no CONTACT_TO_EMAIL secret is set — one address, one
   * place to change it.
   */
  email: 'sheatz.work@gmail.com',
  location: 'Remote',
  // PLACEHOLDER until the domain is registered.
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
    // Real: the only social account that exists today. The other two are
    // placeholders and are filtered out at the point of rendering, so no
    // link to nowhere ever ships.
    { label: 'Instagram', href: 'https://instagram.com/sheatz.any', handle: '@sheatz.any' },
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
};

export function absoluteUrl(path = '/'): string {
  const base = studio.siteUrl.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * The studio mailbox, when it is safe to publish.
 *
 * The single source of truth for what may be rendered, exactly like
 * `publishableSocial()`. The placeholder mailbox used to ship as a live
 * `mailto:` link on every page — a link to nowhere is worse than no link, and
 * the placeholder text reaching public output is the defect the build guard
 * exists for. While the address is unresolved the call sites fall back to the
 * contact form, which works with no configuration at all.
 */
export function publishableEmail(): string | null {
  const email = studio.email.trim();
  if (!email) return null;
  if (/PLACEHOLDER|example\.(com|org|net)/i.test(email)) return null;
  return email;
}

/**
 * A `mailto:` that opens the visitor's own mail client already composed to the
 * studio — the email equivalent of the Instagram link landing on the profile
 * instead of on instagram.com's front page.
 *
 * `encodeURIComponent`, deliberately not `URLSearchParams`: the latter encodes
 * a space as `+`, and several clients put that literally into the subject line.
 * Mail bodies want CRLF, so newlines are normalised before encoding.
 *
 * Returns null when there is no publishable mailbox, so every call site keeps
 * its existing fallback to the contact form.
 */
export function mailtoHref(
  opts: { subject?: string; body?: string } = {},
): string | null {
  const email = publishableEmail();
  if (!email) return null;
  const parts: string[] = [];
  if (opts.subject) parts.push(`subject=${encodeURIComponent(opts.subject)}`);
  if (opts.body) {
    parts.push(`body=${encodeURIComponent(opts.body.replace(/\r?\n/g, '\r\n'))}`);
  }
  return `mailto:${email}${parts.length ? `?${parts.join('&')}` : ''}`;
}

/**
 * The draft an email link hands the visitor's mail client.
 *
 * Kept to three prompts rather than a paragraph, because a compose window
 * full of text to delete is slower than an empty one — and because a
 * pre-written message is the visitor's words about their project, not ours.
 */
export function enquiryDraft(subject: string): { subject: string; body: string } {
  return {
    subject,
    body: [
      'Hi —',
      '',
      'What you want built:',
      'When you want it live:',
      'Anything already in place (repo, design, users):',
      '',
    ].join('\n'),
  };
}

/**
 * External URLs that are safe to link to, or null.
 *
 * Products arrive from D1 with `url` / `availabilityUrl` columns that are
 * still on the placeholder domain. An "Open ↗" button pointing at
 * `https://example.com/...` is a live broken link on the strongest page of
 * the site, so unresolved targets are suppressed at the point of rendering —
 * same doctrine as `publishableSocial()`, one check no call site can forget.
 */
export function publishableUrl(href: string | null | undefined): string | null {
  const value = (href ?? '').trim();
  if (!value) return null;
  if (/PLACEHOLDER|example\.(com|org|net)/i.test(value)) return null;
  return value;
}

/** True while any identity placeholder is still unresolved. */
export function hasPlaceholders(): boolean {
  return (
    publishableEmail() === null ||
    studio.siteUrl === 'https://example.com' ||
    publishableSocial().length < studio.social.length
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
