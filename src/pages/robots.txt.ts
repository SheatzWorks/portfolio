/**
 * robots.txt, generated so the sitemap URL always matches the deployed origin
 * rather than drifting from a hard-coded file.
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

# The admin surface is not content and must never be indexed.
Disallow: /admin
Disallow: /api

Sitemap: ${base}/sitemap.xml
`;

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
  });
};
