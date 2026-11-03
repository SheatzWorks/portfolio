/**
 * security.txt endpoint.
 *
 * Standardized security contact information per RFC 9116.
 * Available at /.well-known/security.txt and /security.txt.
 */
import type { APIRoute } from 'astro';
import { getEnv } from '~/lib/env';
import { studio } from '~/config/site';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const env = await getEnv(locals);
  const base = (env.PUBLIC_SITE_URL || studio.siteUrl).replace(/\/+$/, '');
  const contactEmail = publishableEmail() ?? studio.email;

  const body = `# Security contact for ${studio.name}
Contact: mailto:${contactEmail}
Contact: https://${base}/contact
Preferred-Languages: en
Canonical: ${base}/.well-known/security.txt
Policy: ${base}/security
Expires: ${new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}
`;

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
  });
};

/** Re-export the publishable email check. */
function publishableEmail(): string | null {
  const email = studio.email.trim();
  if (!email) return null;
  if (/PLACEHOLDER|example\.(com|org|net)/i.test(email)) return null;
  return email;
}