/**
 * robots.txt, generated so the sitemap URL always matches the deployed origin
 * rather than drifting from a hard-coded file.
 *
 * Includes explicit policies for search engine crawlers and AI search crawlers.
 * Private areas are protected through actual authentication, not robots directives.
 */
import type { APIRoute } from 'astro';
import { studio } from '~/config/site';
import { getEnv } from '~/lib/env';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const env = await getEnv(locals);
  const base = (env.PUBLIC_SITE_URL || studio.siteUrl).replace(/\/+$/, '');

  const body = `# ${studio.name}
User-agent: *
Allow: /

# Search engine crawlers - full access to public content
User-agent: Googlebot
Allow: /
User-agent: Bingbot
Allow: /
User-agent: Slurp
Allow: /
User-agent: DuckDuckBot
Allow: /
User-agent: Baiduspider
Allow: /
User-agent: YandexBot
Allow: /

# AI search crawlers - allow indexing for answer engines
# These are search/indexing crawlers, not model training crawlers
User-agent: GPTBot
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: OAI-SearchBot
Allow: /
User-agent: OmniBot
Allow: /
User-agent: FacebookBot
Allow: /
User-agent: TwitterBot
Allow: /
User-agent: LinkedInBot
Allow: /

# The admin surface is not content and must never be indexed.
Disallow: /admin
Disallow: /api

# Do not crawl search/filter result pages with parameters
Disallow: /work?*
Disallow: /products?*
Disallow: /services?*
Disallow: /contact?*

Sitemap: ${base}/sitemap.xml
`;

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
  });
};