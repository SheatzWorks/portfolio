/**
 * Distributed Rate Limiter using Cloudflare Durable Objects.
 *
 * Provides globally coordinated rate limiting across all Worker instances.
 * Each bucket/identifier pair gets its own Durable Object instance, ensuring
 * atomic operations without race conditions.
 *
 * Design:
 * - One DO instance per (bucket, identifier) pair
 * - State stored in DO's SQLite storage (persistent, strongly consistent)
 * - Supports sliding window, fixed window, and token bucket algorithms
 * - Automatic cleanup of expired buckets
 */

import type {
  DurableObject,
  DurableObjectState,
  DurableObjectNamespace,
  DurableObjectStub,
  CfProperties,
  Request,
} from '@cloudflare/workers-types';
import type { Env } from './env';

export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  max: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Algorithm: 'sliding' | 'fixed' | 'token-bucket' */
  algorithm?: 'sliding' | 'fixed' | 'token-bucket';
  /** For token bucket: tokens added per window */
  refillRate?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs?: number;
  limit: number;
  windowMs: number;
  resetTimeMs: number;
}

interface StoredState {
  /** Request timestamps for sliding window */
  timestamps: number[];
  /** Token bucket state */
  tokens?: number;
  lastRefill?: number;
  /** Window start for fixed window */
  windowStart?: number;
  count?: number;
  /** Metadata */
  createdAt: number;
  updatedAt: number;
}

const DEFAULT_CONFIG: Required<RateLimitConfig> = {
  max: 100,
  windowMs: 60_000,
  algorithm: 'sliding',
  refillRate: 100,
};

/**
 * Rate Limiter Durable Object.
 *
 * Each instance manages rate limiting for a single (bucket, identifier) pair.
 * The DO ID is derived from the bucket and identifier, ensuring all requests
 * for the same limiter hit the same instance.
 */
export class RateLimiterDO implements DurableObject {
  private state: StoredState;
  private config: Required<RateLimitConfig>;
  private readonly ctx: DurableObjectState;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.state = {
      timestamps: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.config = { ...DEFAULT_CONFIG };
    // Load persisted state
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<StoredState>('state');
      if (stored) {
        this.state = stored;
      }
    });
  }

  /**
   * Handle fetch requests (for RPC-style calls).
   */
  fetch = (async (request: Request): Promise<Response> => {
    return this.handleFetch(request);
  }) as unknown as (request: import('@cloudflare/workers-types').Request<unknown, import('@cloudflare/workers-types').CfProperties<unknown>>) => import('@cloudflare/workers-types').Response | Promise<import('@cloudflare/workers-types').Response>;

  private async handleFetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/configure') {
        const config: RateLimitConfig = await request.json();
        await this.configure(config);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (path === '/check') {
        await this.maybeCleanup();
        const result = this.computeResult(false);
        return new Response(JSON.stringify(result), { status: 200 });
      }

      if (path === '/increment') {
        await this.maybeCleanup();
        const result = await this.increment();
        return new Response(JSON.stringify(result), { status: 200 });
      }

      if (path === '/reset') {
        await this.reset();
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (path === '/state') {
        await this.maybeCleanup();
        const result = this.computeResult(false);
        return new Response(JSON.stringify(result), { status: 200 });
      }

      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : 'Internal error' }),
        { status: 500 }
      );
    }
  }

  /**
   * Configure the rate limiter. Must be called before check/increment.
   */
  async configure(config: RateLimitConfig): Promise<void> {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if a request would be allowed without incrementing.
   */
  async check(): Promise<RateLimitResult> {
    await this.maybeCleanup();
    return this.computeResult(false);
  }

  /**
   * Increment the counter and return the new state.
   */
  async increment(): Promise<RateLimitResult> {
    await this.maybeCleanup();
    const now = Date.now();

    switch (this.config.algorithm) {
      case 'sliding':
        this.state.timestamps.push(now);
        break;
      case 'fixed':
        if (!this.state.windowStart || now - this.state.windowStart >= this.config.windowMs) {
          this.state.windowStart = now;
          this.state.count = 1;
        } else {
          this.state.count = (this.state.count ?? 0) + 1;
        }
        break;
      case 'token-bucket':
        this.refillTokens(now);
        if ((this.state.tokens ?? this.config.max) > 0) {
          this.state.tokens = (this.state.tokens ?? this.config.max) - 1;
        }
        break;
    }

    this.state.updatedAt = now;
    await this.persist();
    return this.computeResult(true);
  }

  /**
   * Reset the limiter (for testing or admin override).
   */
  async reset(): Promise<void> {
    this.state = {
      timestamps: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await this.persist();
  }

  /**
   * Get current state without modifying.
   */
  async getState(): Promise<RateLimitResult> {
    await this.maybeCleanup();
    return this.computeResult(false);
  }

  private async maybeCleanup(): Promise<void> {
    const now = Date.now();
    const cutoff = now - this.config.windowMs;

    switch (this.config.algorithm) {
      case 'sliding':
        this.state.timestamps = this.state.timestamps.filter((t) => t > cutoff);
        break;
      case 'fixed':
        if (this.state.windowStart && now - this.state.windowStart >= this.config.windowMs) {
          this.state.windowStart = now;
          this.state.count = 0;
        }
        break;
      case 'token-bucket':
        this.refillTokens(now);
        break;
    }
  }

  private refillTokens(now: number): void {
    const lastRefill = this.state.lastRefill ?? now;
    const elapsed = now - lastRefill;
    if (elapsed >= this.config.windowMs) {
      const windows = Math.floor(elapsed / this.config.windowMs);
      const newTokens = Math.min(
        this.config.max,
        (this.state.tokens ?? this.config.max) + windows * this.config.refillRate
      );
      this.state.tokens = newTokens;
      this.state.lastRefill = lastRefill + windows * this.config.windowMs;
    }
  }

  private computeResult(incremented: boolean): RateLimitResult {
    const now = Date.now();
    let used: number;
    let remaining: number;
    let resetTimeMs: number;

    switch (this.config.algorithm) {
      case 'sliding': {
        used = this.state.timestamps.length;
        remaining = Math.max(0, this.config.max - used);
        resetTimeMs = this.state.timestamps.length > 0
          ? this.state.timestamps[0] + this.config.windowMs
          : now + this.config.windowMs;
        break;
      }
      case 'fixed': {
        used = this.state.count ?? 0;
        remaining = Math.max(0, this.config.max - used);
        resetTimeMs = (this.state.windowStart ?? now) + this.config.windowMs;
        break;
      }
      case 'token-bucket': {
        const tokens = this.state.tokens ?? this.config.max;
        used = this.config.max - tokens;
        remaining = tokens;
        resetTimeMs = now + this.config.windowMs;
        break;
      }
    }

    const allowed = remaining > 0 || (incremented && used <= this.config.max);
    const retryAfterMs = allowed ? undefined : Math.max(0, resetTimeMs - now);

    return {
      allowed,
      remaining,
      retryAfterMs,
      limit: this.config.max,
      windowMs: this.config.windowMs,
      resetTimeMs,
    };
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put('state', this.state);
  }
}

/**
 * Client-side rate limiter that communicates with the Durable Object via fetch.
 * Provides a familiar interface matching the existing rate-limit.ts API.
 */
export class DistributedRateLimiter {
  private namespace: DurableObjectNamespace;

  constructor(namespace: DurableObjectNamespace) {
    this.namespace = namespace;
  }

  /**
   * Get a rate limiter instance for a specific bucket and identifier.
   */
  private getLimiter(bucket: string, identifier: string): DurableObjectStub {
    // Create a deterministic DO ID from bucket + identifier
    const id = this.namespace.idFromName(`${bucket}:${identifier}`);
    return this.namespace.get(id);
  }

  /**
   * Check rate limit without incrementing.
   */
  async check(
    bucket: string,
    identifier: string,
    config: RateLimitConfig
  ): Promise<RateLimitResult> {
    const limiter = this.getLimiter(bucket, identifier);
    const response = await limiter.fetch('https://internal/configure', {
      method: 'POST',
      body: JSON.stringify(config),
    });
    if (!response.ok) throw new Error('Failed to configure limiter');
    const checkResponse = await limiter.fetch('https://internal/check');
    return checkResponse.json() as Promise<RateLimitResult>;
  }

  /**
   * Increment and check rate limit.
   */
  async increment(
    bucket: string,
    identifier: string,
    config: RateLimitConfig
  ): Promise<RateLimitResult> {
    const limiter = this.getLimiter(bucket, identifier);
    const response = await limiter.fetch('https://internal/configure', {
      method: 'POST',
      body: JSON.stringify(config),
    });
    if (!response.ok) throw new Error('Failed to configure limiter');
    const incResponse = await limiter.fetch('https://internal/increment');
    return incResponse.json() as Promise<RateLimitResult>;
  }

  /**
   * Reset a specific limiter (admin operation).
   */
  async reset(bucket: string, identifier: string): Promise<void> {
    const limiter = this.getLimiter(bucket, identifier);
    const response = await limiter.fetch('https://internal/reset', {
      method: 'POST',
    });
    if (!response.ok) throw new Error('Failed to reset limiter');
  }
}

/**
 * Factory function to create a DistributedRateLimiter from the environment.
 */
export function createDistributedRateLimiter(env: Env): DistributedRateLimiter {
  if (!env.RATE_LIMITER) {
    throw new Error('RATE_LIMITER Durable Object namespace not bound');
  }
  return new DistributedRateLimiter(env.RATE_LIMITER as DurableObjectNamespace);
}