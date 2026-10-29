/**
 * Sitemap.
 *
 * Server-rendered from the projects table so a newly published case study is
 * discoverable without a rebuild. Static routes are listed from a constant
 * rather than by walking the filesystem, so the list stays honest and reviewable.
 */
import type { APIRoute } from 'astro';
import { studio } from '~/config/site';
import { getEnv } from '~/lib/env';
import { listPublishedProjects, readFallback } from '~/lib/db';

export const prerender = false;

const STATIC_ROUTES: { path: string; priority: string; changefreq: string }[] = [
  { path: '/', priority: '1.0', changefreq: 'weekly' },
  { path: '/work', priority: '0.9', changefreq: 'weekly' },
  { path: '/products', priority: '0.9', changefreq: 'weekly' },
  { path: '/services', priority: '0.8', changefreq: 'monthly' },
  { path: '/about', priority: '0.7', changefreq: 'monthly' },
  { path: '/contact', priority: '0.8', changefreq: 'yearly' },
  { path: '/privacy', priority: '0.3', changefreq: 'yearly' },
  { path: '/terms', priority: '0.3', changefreq: 'yearly' },
];

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const GET: APIRoute = async ({ locals }) => {
  const env = await getEnv(locals);
  const base = (env.PUBLIC_SITE_URL || studio.siteUrl).replace(/\/+$/, '');

  let projects: Awaited<ReturnType<typeof listPublishedProjects>> = [];
  if (env.DB) {
    projects = await listPublishedProjects(env.DB as never).catch(
      readFallback('sitemap.projects', [] as typeof projects),
    );
  }

  const entries: string[] = [];

  for (const route of STATIC_ROUTES) {
    entries.push(
      `  <url><loc>${escapeXml(`${base}${route.path}`)}</loc>` +
        `<changefreq>${route.changefreq}</changefreq>` +
        `<priority>${route.priority}</priority></url>`,
    );
  }

  /*
   * Commissions live under /work and products under /products. Emitting both
   * under one prefix would put products on the client-work route, which is the
   * distinction the site is built around.
   *
   * Every published project is listed, with or without a written case study:
   * the route renders a designed page either way, and a published project that
   * is absent from the sitemap is a page a crawler may never find.
   */
  for (const project of projects) {
    const prefix = project.ownership === 'own' ? '/products' : '/work';
    entries.push(
      `  <url><loc>${escapeXml(`${base}${prefix}/${project.slug}`)}</loc>` +
        (project.updatedAt
          ? `<lastmod>${escapeXml(project.updatedAt.slice(0, 10))}</lastmod>`
          : '') +
        `<changefreq>monthly</changefreq><priority>0.8</priority></url>`,
    );
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600, s-maxage=3600',
    },
  });
};
