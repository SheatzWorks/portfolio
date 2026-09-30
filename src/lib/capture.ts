/**
 * Capture provider adapter.
 *
 * The preview system needs *some* way to render a third-party page. Where that
 * renderer runs is a deployment decision, not an application one, so it is
 * expressed as a small interface with interchangeable implementations.
 *
 *   browserless — hosted capture over plain HTTP REST. Works from inside a
 *                 Cloudflare Worker, needs no VM, and the free tier is ample
 *                 for a two-person studio (~1,000 browser-minutes/month
 *                 against roughly one capture a fortnight).
 *   local      — a real Playwright Chromium on a machine we control. Slower to
 *                 set up, but it is the only path that can also record video,
 *                 because video needs a persistent browser to screencast from.
 *
 * Security note that shapes this design: a hosted provider's browser runs in
 * the *provider's* network, not ours. It is therefore architecturally incapable
 * of reaching Cloudflare D1, R2, or any internal service, which removes the
 * high-risk half of the SSRF surface entirely. See docs/security.md.
 *
 * A Worker cannot run Playwright itself: there is no Node runtime, no Chromium,
 * and the 128 MB isolate cap rules out buffering screencast frames.
 */

export interface CaptureRequest {
  url: string;
  /** Logical viewport width. Height is derived to keep 16:9. */
  width?: number;
  /** Device pixel ratio. 2 for retina-sharp cards. */
  scale?: number;
  /** Milliseconds to wait after load for fonts/layout to settle. */
  settleMs?: number;
  /** Optional script to run in the page before capture. */
  script?: string;
}

export interface CaptureResult {
  /** Raw image bytes, PNG or JPEG. */
  body: Uint8Array;
  contentType: string;
  /** Which provider actually produced this, for the job log. */
  provider: string;
  /** Set when the provider returned a non-image (challenge page, error body). */
  warning?: string;
}

export interface CaptureProvider {
  readonly name: string;
  /** False when the provider is not configured, so the dispatcher can skip. */
  isConfigured(): boolean;
  capture(request: CaptureRequest): Promise<CaptureResult>;
}

/** Provider that always fails cleanly, so the pipeline degrades predictably. */
export const noopProvider: CaptureProvider = {
  name: 'none',
  isConfigured: () => false,
  capture: async () => {
    throw new Error('No capture provider is configured.');
  },
};

/** Browserless.io / a self-hosted Browserless, over its REST API. */
export function browserlessProvider(config: {
  endpoint?: string;
  token?: string;
}): CaptureProvider {
  const endpoint = (config.endpoint ?? 'https://production.browserless.io').replace(/\/+$/, '');
  // The free tier works without a token; a self-hosted instance needs none.
  const token = config.token;

  return {
    name: 'browserless',
    isConfigured: () => true,

    async capture(request: CaptureRequest): Promise<CaptureResult> {
      const width = request.width ?? 1440;
      const scale = request.scale ?? 2;
      const height = Math.round((width * 9) / 16);

      const url = new URL(`${endpoint}/screenshot`);
      if (token) url.searchParams.set('token', token);

      const body = {
        url: request.url,
        // 'png' is lossless and the pipeline re-encodes to AVIF/WebP anyway,
        // so there is no point paying for browser-side JPEG artefacts.
        type: 'png' as const,
        fullPage: false,
        viewport: { width, height },
        deviceScaleFactor: scale,
        // Deterministic capture: no animation, no caret, no scrollbars.
        options: {
          animation: 'disabled' as const,
          caret: 'hide' as const,
          hideScrollbars: true,
          // Block the heaviest third-party categories. This is the single
          // biggest lever on capture time and it avoids capturing consent
          // dialogs and analytics beacons mid-render.
          blockedURLs: [
            '*doubleclick*',
            '*googletagmanager*',
            '*google-analytics*',
            '*hotjar*',
            '*intercom*',
            '*segment*',
            '*facebook.net*',
            '*twitter.com/widgets*',
          ],
        },
        // `waitUntil: networkidle2` is the pragmatic setting: it waits for the
        // page to settle without hanging on long-polling connections.
        waitUntil: 'networkidle2',
        timeout: 30_000,
        ...(request.settleMs ? { delay: request.settleMs } : {}),
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45_000);
      try {
        const response = await fetch(url.toString(), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new Error(`Capture provider returned ${response.status}: ${detail.slice(0, 200)}`);
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.startsWith('image/')) {
          // Usually an HTML challenge page. Surface it rather than storing
          // HTML as if it were a screenshot.
          throw new Error(`Capture provider returned ${contentType || 'unknown'} instead of an image.`);
        }

        return {
          body: new Uint8Array(await response.arrayBuffer()),
          contentType,
          provider: 'browserless',
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * Local Playwright capture. Runs in Node, so it is used by the capture script
 * and by any self-hosted worker — never from inside a Cloudflare Worker.
 */
export function localPlaywrightProvider(): CaptureProvider {
  return {
    name: 'local',
    isConfigured: () => true,
    async capture(request: CaptureRequest): Promise<CaptureResult> {
      /*
       * The specifier is held in a variable and marked @vite-ignore so the
       * bundler treats it as opaque. A literal `import('playwright-core')`
       * pulls the whole Playwright bundle into the Worker — which cannot run it
       * anyway, and which breaks the build on Node-only subpath imports.
       */
      const specifier = 'playwright-core';
      const { chromium } = (await import(/* @vite-ignore */ specifier)) as typeof import('playwright-core');

      const width = request.width ?? 1440;
      const height = Math.round((width * 9) / 16);

      const browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--hide-scrollbars',
          '--force-color-profile=srgb',
          '--disable-lcd-text',
        ],
      });

      try {
        // A fresh context per capture: no cookie or storage leakage between
        // projects, and consistent rendering every time.
        const context = await browser.newContext({
          viewport: { width, height },
          deviceScaleFactor: request.scale ?? 2,
          colorScheme: 'dark',
          // Locks rendering so two captures of the same page are byte-identical.
          reducedMotion: 'reduce',
          forcedColors: 'none',
          locale: 'en',
          timezoneId: 'UTC',
        });

        const page = await context.newPage();

        // Block heavy third-party categories. Cuts capture time dramatically
        // and prevents a consent modal from being photographed.
        await page.route('**/*', (route) => {
          const url = route.request().url();
          const type = route.request().resourceType();
          if (type === 'font' || type === 'media') return route.abort();
          if (/doubleclick|googletagmanager|google-analytics|hotjar|intercom|segment|facebook\.net/i.test(url)) {
            return route.abort();
          }
          return route.continue();
        });

        const response = await page.goto(request.url, {
          waitUntil: 'networkidle',
          timeout: 30_000,
        });

        if (response && !response.ok() && response.status() >= 400) {
          throw new Error(`Target returned ${response.status()}.`);
        }

        // Let webfonts settle, otherwise the capture catches the fallback face.
        await page.evaluate(() => document.fonts?.ready).catch(() => {});
        await page.waitForTimeout(request.settleMs ?? 600);

        if (request.script) {
          await page.evaluate(request.script).catch(() => {});
        }

        const buffer = await page.screenshot({
          type: 'png',
          animations: 'disabled',
          caret: 'hide',
        });

        return { body: new Uint8Array(buffer), contentType: 'image/png', provider: 'local' };
      } finally {
        await browser.close();
      }
    },
  };
}

/** Chooses a provider from configuration. Never throws. */
export function selectProvider(env: {
  CAPTURE_PROVIDER?: string;
  BROWSERLESS_URL?: string;
  BROWSERLESS_TOKEN?: string;
}): CaptureProvider {
  switch ((env.CAPTURE_PROVIDER ?? 'none').toLowerCase()) {
    case 'browserless':
      return browserlessProvider({ endpoint: env.BROWSERLESS_URL, token: env.BROWSERLESS_TOKEN });
    case 'local':
      return localPlaywrightProvider();
    default:
      return noopProvider;
  }
}
