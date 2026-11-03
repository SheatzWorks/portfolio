/**
 * Health check endpoint.
 *
 * Provides basic health information without exposing sensitive details.
 * Used by uptime monitors and load balancers.
 */
import type { APIRoute } from 'astro';
import { getEnv, hasDb } from '~/lib/env';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const env = await getEnv(locals);
  const dbHealthy = hasDb(env);

  // Basic health response
  const health = {
    status: dbHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks: {
      database: dbHealthy ? 'ok' : 'unavailable',
      // Add more checks as needed
    },
    version: '1.0.0',
  };

  const status = dbHealthy ? 200 : 503;

  return new Response(JSON.stringify(health), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
};