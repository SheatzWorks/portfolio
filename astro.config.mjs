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
        /*
         * `strict-dynamic` is deliberately OFF, and that is a change.
         *
         * It was on while the site shipped zero external JavaScript: hashes
         * covered every inline script and there was nothing else to allow.
         * `strict-dynamic` also disables allow-list expressions — including
         * `'self'` — so the moment the site bundled a real module (the motion
         * layer in src/scripts/motion.ts) the browser refused to load it and
         * every scroll reveal silently fell back to the 3s failsafe.
         *
         * The property we were actually buying with it was "no script from a
         * host we did not choose". That still holds here: scripts are `'self'`
         * plus hashes, there is no user-supplied markup rendered as HTML (the
         * contact form writes to D1 as text), and R2 holds images rather than
         * anything executable. Third-party script is still a named exception
         * rather than an accident — Turnstile is the only entry in resources,
         * and it is inert until a site key is configured.
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
         * connect-src makes Astro warn at build time, because a second
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
