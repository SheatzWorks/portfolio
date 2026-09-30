// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Site origin. PLACEHOLDER — swap in the real domain here (one line) once registered.
// Used for canonical URLs, sitemap, Open Graph images and Turnstile hostname checks.
const SITE = process.env.PUBLIC_SITE_URL ?? 'https://example.com';

export default defineConfig({
  site: SITE,

  // Pages we explicitly want server-rendered opt in per-route with
  // `export const prerender = false`. Everything else is prerendered to static
  // HTML, which is what keeps the LCP-critical pages at zero runtime cost.
  output: 'static',

  adapter: cloudflare({
    // 'compile' runs the image service (sharp) at BUILD time and emits static
    // variants. The adapter default is 'cloudflare-binding', which is a paid
    // Images binding and would add per-transform billing for every screenshot
    // variant we already pre-generate ourselves in the capture pipeline.
    imageService: 'compile',
  }),

  build: {
    // Inline the CSS actually used by a page. Keeps the critical path to a
    // single render-blocking file with no extra request.
    inlineStylesheets: 'auto',
  },

  compressHTML: true,

  markdown: {
    // Shiki emits inline styles for token colours, which our CSP does not
    // allow and which cannot be hash-whitelisted the way a <style> block can.
    // The site has no code blocks that need highlighting; if one is ever added,
    // switch to Prism rather than weakening the policy.
    syntaxHighlight: false,
  },

  security: {
    // CSRF protection for on-demand rendered POST/PUT/PATCH/DELETE.
    // Left enabled deliberately — the contact form depends on it.
    checkOrigin: true,
    csp: {
      scriptDirective: {
        // We ship no third-party scripts and no inline event handlers, so the
        // hash-based script-src Astro generates is sufficient on its own.
        strictDynamic: true,
        /*
         * Cloudflare Turnstile is the one third-party script this site may load,
         * and only when a Turnstile site key is configured. It must be declared
         * here rather than as a raw `script-src-elem` string in `directives`:
         * Astro rejects script-src and style-src (and their -elem/-attr
         * variants) in that array, and the config fails to load when it sees
         * one — which fails the whole build, silently, leaving a stale dist.
         */
        resources: ["'self'", 'https://challenges.cloudflare.com'],
      },
      styleDirective: {
        resources: ["'self'"],
      },
      // Everything Astro does not model. These live in the SAME policy as the
      // hashes Astro generates — emitting a second CSP in a header would
      // intersect with this one and, because it cannot know the per-page
      // hashes, would block Astro's own inline scripts.
      directives: [
        "default-src 'self'",

        // Previews hot-link og: images from arbitrary project sites.
        "img-src 'self' data: https:",
        "media-src 'self' https:",
        "font-src 'self'",

        /*
         * Every directive below appears EXACTLY ONCE. A duplicate frame-src or
         // connect-src makes Astro warn at build time, because a second
         * occurrence does not add to the first.
         */
        // Frames: /creations embeds allowlisted project previews, and
        // Cloudflare Turnstile renders itself in an iframe. Both are only used
        // when the relevant feature is configured.
        "frame-src 'self' https: https://challenges.cloudflare.com",
        "connect-src 'self' https://challenges.cloudflare.com",

        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        // frame-ancestors is deliberately NOT here: browsers ignore it in a
        // <meta> element, so it is sent as a header from src/middleware.ts.
        'upgrade-insecure-requests',
      ],
    },
  },

  devToolbar: { enabled: false },

  vite: {
    build: {
      cssMinify: 'lightningcss',
    },
  },
});
