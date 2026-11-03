/**
 * Typed access to the Cloudflare runtime bindings.
 *
 * Reading the environment through one function keeps the binding names in a
 * single place and makes the D1 dependency trivially stubbable in tests.
 *
 * Astro 6 removed `Astro.locals.runtime.env`. The supported replacement is the
 * `cloudflare:workers` module, which is resolved dynamically here for two
 * reasons: a static import would break `vitest` (which runs in plain Node with
 * no Workers runtime), and the specifier must not be statically analysed by
 * Vite. Tests inject a fake via `setTestEnv()` instead.
 */

import type { D1Database, R2Bucket, DurableObjectNamespace } from '@cloudflare/workers-types';

export interface Env {
  DB?: D1Database;
  MEDIA?: R2Bucket;
  /** Durable Object namespace for distributed rate limiting */
  RATE_LIMITER?: DurableObjectNamespace;
  /** Canonical origin, e.g. https://example.com */
  PUBLIC_SITE_URL?: string;
  MEDIA_BASE_URL?: string;
  /** 'none' | 'browserless' | 'local' */
  CAPTURE_PROVIDER?: string;
  /**
   * 'egress'   — the Worker fetches project pages itself (subject to SSRF rules)
   * 'disabled' — never fetch; rely only on already-stored metadata
   */
  PREVIEW_FETCH_MODE?: string;
  /** Comma-separated host allowlist. Non-empty makes SSRF impossible. */
  ALLOWED_CAPTURE_HOSTS?: string;
  /** Browserless endpoint + token (the free tier works without a token). */
  BROWSERLESS_URL?: string;
  BROWSERLESS_TOKEN?: string;
  RESEND_API_KEY?: string;
  CONTACT_TO_EMAIL?: string;
  CONTACT_FROM_EMAIL?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  /** Shared secret gating /admin and the job-dispatch endpoint. */
  ADMIN_TOKEN?: string;
  /** Pepper for MFA secret hashing (should be different from ADMIN_TOKEN). */
  MFA_PEPPER?: string;
  /** Salt for the truncated one-way IP hash used by the rate limiter. */
  RATE_LIMIT_SALT?: string;
}

let testEnv: Env | null = null;

/** Injects a fake environment. Used by tests and by the local capture CLI. */
export function setTestEnv(env: Env | null): void {
  testEnv = env;
}

let runtimeEnvPromise: Promise<Env> | null = null;

async function loadRuntimeEnv(): Promise<Env> {
  if (!runtimeEnvPromise) {
    runtimeEnvPromise = (async () => {
      try {
        const mod = (await import(/* @vite-ignore */ 'cloudflare:workers')) as { env?: Env };
        return mod.env ?? {};
      } catch {
        // Not running on Workers (tests, scripts, astro dev without bindings).
        return {};
      }
    })();
  }
  return runtimeEnvPromise;
}

/**
 * Resolves the runtime environment.
 *
 * Note: `locals.runtime` is deliberately never read. In Astro 6 it is not a
 * plain missing property — the getter itself throws, so even a guarded access
 * to it would raise. The Workers module is the supported path, and tests
 * inject a fake via `setTestEnv()`.
 */
/**
 * Values that must also be readable while the site is being built.
 *
 * Prerendered routes (/contact, /privacy, /terms, /404) call `getEnv()` during
 * `astro build`, where `cloudflare:workers` does not exist and the runtime
 * bindings are empty. Without a build-time fallback those pages shipped
 * `https://example.com` canonicals and a contact form with no Turnstile widget,
 * even on a correctly configured deployment.
 *
 * Only public values are read here: the Turnstile *site* key is public by
 * design, and no secret is ever exposed to the build.
 */
function buildTimeValue(key: string): string | undefined {
  const meta = (import.meta as { env?: Record<string, unknown> }).env;
  const fromMeta = meta?.[key];
  const fromProcess = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  const value = fromMeta ?? fromProcess;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export async function getEnv(_locals?: unknown): Promise<Env> {
  if (testEnv) return testEnv;

  const runtime = await loadRuntimeEnv();
  return {
    ...runtime,
    PUBLIC_SITE_URL: runtime.PUBLIC_SITE_URL ?? buildTimeValue('PUBLIC_SITE_URL'),
    MEDIA_BASE_URL: runtime.MEDIA_BASE_URL ?? buildTimeValue('MEDIA_BASE_URL'),
    TURNSTILE_SITE_KEY: runtime.TURNSTILE_SITE_KEY ?? buildTimeValue('TURNSTILE_SITE_KEY'),
  };
}

export function getDb(env: Env): D1Database {
  if (!env.DB) {
    throw new Error('D1 binding "DB" is not configured. See docs/deployment.md.');
  }
  return env.DB;
}

/**
 * Whether the D1 binding resolved.
 *
 * Callers must branch on this separately from "the table is empty". A missing
 * binding previously fell through the same `if (db)` check as an empty table, so
 * a total data outage rendered the designed empty state and looked like a
 * portfolio with no work in it.
 */
export function hasDb(env: Env): boolean {
  return Boolean(env.DB);
}

/** Parse the host allowlist env var into a normalised array. */
export function parseHostAllowlist(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter(Boolean);
}
