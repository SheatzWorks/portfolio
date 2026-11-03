/**
 * .well-known/security.txt endpoint.
 *
 * Redirects to /security.txt for RFC 9116 compliance.
 */
import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async () =>
  new Response(null, {
    status: 301,
    headers: { location: '/security.txt' },
  });