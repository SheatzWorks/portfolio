/**
 * Sitemap.
 *
 * Server-rendered from the projects table so a newly published case study is
 * discoverable without a rebuild. Static routes are listed from a constant
 * rather than by walking the filesystem, so the list stays honest and reviewable.
 *
 * Includes image sitemap entries for project previews (when available).
 */
import type { APIRoute } from 'astro';
import { studio } from '~/config/site';
import { getEnv } from '~/lib/env';
import { listPublishedProjects, readFallback } from '~/lib/db';
import { resolvePreview } from '~/lib/preview';
import { getMediaBaseUrl } from '~/lib/preview';

export const prerender = false;

const STATIC_ROUTES: { path: string; priority: string; changefreq: string; lastmod?: string }[] = [
  { path: '/', priority: '1.0', changefreq: 'weekly', lastmod: new Date().toISOString().slice(0, 10) },
  { path: '/work', priority: '0.9', changefreq: 'weekly', lastmod: new Date().toISOString().slice(0, 10) },
  { path: '/products', priority: '0.9', changefreq: 'weekly', lastmod: new Date().toISOString().slice(0, 10) },
  { path: '/services', priority: '0.8', changefreq: 'monthly', lastmod: new Date().toISOString().slice(0, 10) },
  { path: '/about', priority: '0.7', changefreq: 'monthly', lastmod: new Date().toISOString().slice(0, 10) },
  { path: '/contact', priority: '0.8', changefreq: 'monthly', lastmod: new Date().toISOString().slice(0, 10) },
  { path: '/privacy', priority: '0.3', changefreq: 'yearly', lastmod: new Date().toISOString().slice(0, 10) },
  { path: '/terms', priority: '0.3', changefreq: 'yearly', lastmod: new Date().toISOString().slice(0, 10) },
  { path: '/llms.txt', priority: '0.5', changefreq: 'monthly', lastmod: new Date().toISOString().slice(0, 10) },
];

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&apos;');
}

export const GET: APIRoute = async ({ locals }) => {
  const env = await getEnv(locals);
  const base = (env.PUBLIC_SITE_URL || studio.siteUrl).replace(/\/+$/, '');
  const mediaBase = getMediaBaseUrl().replace(/\/+$/, '');

  let projects: Awaited<ReturnType<typeof listPublishedProjects>> = [];
  if (env.DB) {
    projects = await listPublishedProjects(env.DB as never).catch(
      readFallback('sitemap.projects', [] as typeof projects),
    );
  }

  const entries: string[] = [];

  for (const route of STATIC_ROUTES) {
    const lastmod = route.lastmod ? `<lastmod>${escapeXml(route.lastmod)}</lastmod>` : '';
    entries.push(
      `  <url><loc>${escapeXml(`${base}${route.path}`)}</loc>` +
        lastmod +
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
   *
   * Include image sitemap entries when preview images are available.
   */
  for (const project of projects) {
    const prefix = project.ownership === 'own' ? '/products' : '/work';
    const url = `${base}${prefix}/${project.slug}`;
    const lastmod = project.updatedAt
      ? `<lastmod>${escapeXml(project.updatedAt.slice(0, 10))}</lastmod>`
      : '';

    // Build image entries if preview images exist
    const preview = resolvePreview(project.preview);
    const imageEntries: string[] = [];
    if (preview.imageUrl) {
      // Main image
      imageEntries.push(
        `    <image:image><image:loc>${escapeXml(preview.imageUrl)}</image:loc></image:image>`
      );
      // Responsive variants
      if (preview.srcset) {
        for (const srcsetEntry of preview.srcset.split(', ')) {
          const [srcUrl] = srcsetEntry.split(' ');
          if (srcUrl && srcUrl !== preview.imageUrl) {
            imageEntries.push(
              `    <image:image><image:loc>${escapeXml(srcUrl)}</image:loc></image:image>`
            );
          }
        }
      }
    }

    const imagesXml = imageEntries.length > 0
      ? '\n' + imageEntries.join('\n')
      : '';

    entries.push(
      `  <url><loc>${escapeXml(url)}</loc>` +
        lastmod +
        `<changefreq>monthly</changefreq><priority>0.8</priority>` +
        imagesXml +
        `</url>`,
    );
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
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