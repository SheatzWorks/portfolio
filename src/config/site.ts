/**
 * Site configuration — the single place real values live.
 *
 * Every string below marked PLACEHOLDER is obviously fake on purpose. Nothing
 * here invents a client, a metric, a testimonial, or a claim. When the studio
 * has real details, replace the value and nothing else needs to change.
 *
 * Runtime values (secrets, bindings) come from Cloudflare, not this file.
 */

export interface SocialLink {
  label: string;
  href: string;
  handle?: string;
}

export interface StudioConfig {
  /** PLACEHOLDER — studio name. Appears in the header, footer, and JSON-LD. */
  name: string;
  /** PLACEHOLDER — one line, no adjectives that cannot be demonstrated. */
  tagline: string;
  /** PLACEHOLDER — used in meta descriptions and structured data. */
  description: string;
  /**
   * PLACEHOLDER — the two people. Roles are described by what they do, not by
   * seniority. `focus` lists the parts of a project they own.
   */
  people: ReadonlyArray<{
    name: string;
    role: string;
    bio: string;
    focus: readonly string[];
    links: readonly SocialLink[];
  }>;
  /** PLACEHOLDER — where enquiries go. Shown as click-to-copy, never a form gate. */
  email: string;
  location: string;
  social: readonly SocialLink[];
  /** PLACEHOLDER — swap the whole URL when the domain is registered. */
  siteUrl: string;
}

export const studio: StudioConfig = {
  name: 'Studio Name',
  tagline: 'Two engineers building websites, web apps and the software behind them.',
  description:
    'A two-person digital studio designing and engineering websites, web applications and product software. Work is shown as built, not described.',
  people: [
    {
      name: 'First Name',
      role: 'Engineering & backend',
      bio: 'PLACEHOLDER bio — one short paragraph. What they do, what they are good at, what a client can expect from working with them.',
      focus: ['Application architecture', 'APIs & data', 'Performance', 'Infrastructure'],
      links: [],
    },
    {
      name: 'Second Name',
      role: 'Design & frontend',
      bio: 'PLACEHOLDER bio — one short paragraph. What they do, what they are good at, what a client can expect from working with them.',
      focus: ['Interface design', 'Frontend engineering', 'Accessibility', 'Motion'],
      links: [],
    },
  ],
  email: 'hello@example.com',
  location: 'Remote',
  social: [
    { label: 'Instagram', href: 'https://instagram.com/PLACEHOLDER', handle: '@PLACEHOLDER' },
    { label: 'GitHub', href: 'https://github.com/PLACEHOLDER' },
    { label: 'LinkedIn', href: 'https://linkedin.com/in/PLACEHOLDER' },
    { label: 'Email', href: 'mailto:hello@example.com' },
  ],
  siteUrl: 'https://example.com',
};

/**
 * Media origins. Screenshots and preview video live in R2 behind a custom
 * domain so the site never depends on the media host's JS, cookies or uptime.
 */
export const media = {
  baseUrl: 'https://media.example.com',
  /**
   * Hosts the live-iframe preview is allowed to frame. Every project URL is
   * checked against this list at render time; anything not listed falls back to
   * a screenshot. Keep it narrow — see docs/security.md.
   */
  framableHosts: [] as readonly string[],
};

/** Absolute URL builder. Everything canonical routes through this. */
export function absoluteUrl(path = '/'): string {
  const base = studio.siteUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}
