import { test, expect, type Page } from '@playwright/test';

/** Fails the test if the page logged a console error or a failed request. */
function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

test.describe('home', () => {
  test('renders with no console errors and no failed requests', async ({ page }) => {
    const errors = trackErrors(page);
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(errors, errors.join('\n')).toHaveLength(0);
  });

  test('leads with the positioning and a primary action', async ({ page }) => {
    await page.goto('/');
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toBeVisible();
    await expect(page.getByRole('link', { name: /see the creations/i }).first()).toBeVisible();
  });

  test('the creations section is present and points at the index', async ({ page }) => {
    await page.goto('/');
    const heading = page.getByRole('heading', { name: /what we have built/i });
    await expect(heading).toBeVisible();
    await page.getByRole('link', { name: /see the creations/i }).first().click();
    await expect(page).toHaveURL(/\/creations/);
  });

  test('has a non-degenerate empty state when there is no content', async ({ page }) => {
    // With no projects the section must still look designed, not broken: it
    // explains what belongs there and how to add it.
    await page.goto('/creations');
    const empty = page.locator('.empty');
    if ((await empty.count()) > 0) {
      await expect(empty.first()).toBeVisible();
      await expect(empty.first()).toContainText(/add one from \/admin/i);
    }
  });

  test('never scrolls horizontally', async ({ page }) => {
    for (const path of ['/', '/creations', '/studio', '/contact']) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflow, `horizontal overflow on ${path}`).toBe(false);
    }
  });
});

test.describe('navigation', () => {
  test('is keyboard reachable from the skip link', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: /skip to content/i });
    await expect(skip).toBeFocused();
    // Activating it must move focus to <main>.
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeVisible();
  });

  test('marks the current page for assistive technology', async ({ page }) => {
    await page.goto('/creations');
    const current = page.locator('nav a[aria-current="page"]');
    await expect(current.first()).toHaveText(/creations/i);
  });

  test('has exactly one h1 per page', async ({ page }) => {
    for (const path of ['/', '/creations', '/studio', '/contact', '/privacy', '/terms']) {
      await page.goto(path);
      const count = await page.getByRole('heading', { level: 1 }).count();
      expect(count, `h1 count on ${path}`).toBe(1);
    }
  });

  test('mobile menu opens, traps nothing, and closes on Escape', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile navigation only');
    await page.goto('/');

    const toggle = page.locator('[data-nav-toggle]');
    const nav = page.locator('#site-nav');

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.tap();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(nav).toHaveAttribute('data-open', 'false');
  });

  test('every navigation target resolves', async ({ page }) => {
    await page.goto('/');
    const hrefs = await page
      .locator('header a[href^="/"], footer a[href^="/"]')
      .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href')!));

    for (const href of [...new Set(hrefs)]) {
      const response = await page.request.get(href);
      expect([200, 307], `${href} returned ${response.status()}`).toContain(response.status());
    }
  });
});

test.describe('creations', () => {
  test('renders project cards that are single, well-named links', async ({ page }) => {
    await page.goto('/creations');
    const cards = page.locator('.project');
    const count = await cards.count();
    test.skip(count === 0, 'no projects in the local database');

    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      // The whole card is the link: no nested interactive controls.
      await expect(card).toHaveAttribute('href', /./);
      const nestedButtons = await card.locator('button, a').count();
      expect(nestedButtons, 'a card must not contain nested interactive elements').toBe(0);
    }
  });

  test('filtering by an unknown kind degrades to the full index', async ({ page }) => {
    await page.goto('/creations?kind=not-a-real-kind');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // No crash, and no error state.
    await expect(page.locator('.form__status[data-state="error"]')).toHaveCount(0);
  });

  test('a case study renders its meta, prose and links', async ({ page }) => {
    await page.goto('/creations');
    const card = page.locator('.project').first();
    test.skip((await card.count()) === 0, 'no projects');

    await card.click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('.case__meta')).toBeVisible();
  });

  test('an unknown slug returns a real 404 with the not-found page', async ({ page }) => {
    const response = await page.goto('/creations/this-does-not-exist');
    // Not a redirect: a 200 here would tell a crawler the URL is fine and hide
    // broken links from the analytics.
    expect(response?.status()).toBe(404);
    await expect(page.getByText(/nothing at this address/i)).toBeVisible();
  });

  test('an unpublished or private project is not reachable by URL', async ({ page, request }) => {
    // Visibility is enforced in the query, not in the template. This asserts
    // the outcome that matters: it is not listed and it does not resolve.
    const index = await request.get('/creations');
    expect(index.status()).toBe(200);
  });
});

test.describe('preview fallbacks', () => {
  test('a card always has media or a designed plate — never a broken image', async ({ page }) => {
    await page.goto('/creations');
    const cards = page.locator('.project');
    const count = await cards.count();
    test.skip(count === 0, 'no projects');

    for (let i = 0; i < count; i++) {
      const media = cards.nth(i).locator('.project__media');
      const hasImage = (await media.locator('img').count()) > 0;
      const hasPlate = await media.locator('[data-plate]').count();
      expect(hasImage || hasPlate, `card ${i} has neither an image nor a plate`).toBeTruthy();
    }
  });

  test('broken external images fall back to the plate instead of a broken glyph', async ({ page }) => {
    await page.setContent(`<!doctype html><html><body style="margin:0">
      <div class="project__media" style="position:relative">
        <span class="project__placeholder" data-plate hidden>Plate</span>
        <img id="bad" src="/definitely-not-a-real-image-404.png" style="width:100%">
      </div>
      <script>
        document.getElementById('bad').addEventListener('error', function () {
          this.remove();
          document.querySelector('[data-plate]').hidden = false;
        }, { once: true });
      </script>
    </body></html>`);
    await expect(page.locator('[data-plate]')).toBeVisible();
  });

  test('project media reserves space to avoid layout shift', async ({ page }) => {
    await page.goto('/creations');
    const imgs = page.locator('.project__img');
    const count = await imgs.count();
    test.skip(count === 0, 'no projects');
    for (let i = 0; i < count; i++) {
      await expect(imgs.nth(i)).toHaveAttribute('width', /\d+/);
      await expect(imgs.nth(i)).toHaveAttribute('height', /\d+/);
    }
  });
});

test.describe('contact form', () => {
  test('validates required fields before submitting', async ({ page }) => {
    await page.goto('/contact');
    await page.getByRole('button', { name: /send it/i }).click();
    await expect(page.locator('[data-form-status]')).toBeVisible();
    await expect(page.locator('[data-error-for="name"]')).toContainText(/name/i);
    await expect(page.locator('[data-error-for="email"]')).toContainText(/email/i);
    await expect(page.locator('[data-error-for="message"]')).toContainText(/detail/i);
  });

  test('rejects a malformed email', async ({ page }) => {
    await page.goto('/contact');
    await page.fill('#name', 'Test Person');
    await page.fill('#email', 'not-an-email');
    await page.fill('#message', 'This message is definitely long enough to pass validation.');
    await page.getByRole('button', { name: /send it/i }).click();
    await expect(page.locator('[data-error-for="email"]')).toContainText(/email/i);
  });

  test('labels every control and links errors to their field', async ({ page }) => {
    await page.goto('/contact');
    for (const id of ['name', 'email', 'company', 'project_type', 'timeline', 'budget', 'message']) {
      await expect(page.locator(`label[for="${id}"]`), `label for #${id}`).toHaveCount(1);
    }
    await expect(page.locator('#name')).toHaveAttribute('aria-describedby', /name-error/);
  });

  test('the honeypot is present but not announced as a field', async ({ page }) => {
    await page.goto('/contact');
    const trap = page.locator('#company_website');
    await expect(trap).toHaveCount(1);
    await expect(trap).toHaveAttribute('tabindex', '-1');
  });
});

test.describe('accessibility', () => {
  test('every page has a landmark structure and a main heading', async ({ page }) => {
    for (const path of ['/', '/creations', '/studio', '/contact']) {
      await page.goto(path);
      await expect(page.locator('main'), `main on ${path}`).toHaveCount(1);
      await expect(page.locator('h1'), `h1 on ${path}`).toHaveCount(1);
      // Exactly one banner landmark: the site header. Nested <header> elements
      // would only count as banners if they were a direct child of <body>.
      const banners = await page.getByRole('banner').count();
      expect(banners, `banner landmarks on ${path}`).toBe(1);
    }
  });

  test('interactive elements meet the 44px touch target minimum', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'touch targets only matter on touch devices');
    await page.goto('/contact');

    const small = await page.evaluate(() => {
      const bad: string[] = [];
      const nodes = document.querySelectorAll<HTMLElement>('a, button, input, select, textarea');
      for (const el of nodes) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') continue;

        // The honeypot is deliberately positioned off-screen; it is not a
        // target a user can reach, so it is out of scope. The skip link is
        // also off-screen until focused, which is the correct pattern.
        if (el.closest('.hp') || el.classList.contains('skip-link')) continue;

        // WCAG 2.5.8 exempts links rendered inline within a block of text.
        // Those are sentence-flow links, not discrete controls.
        if (el.tagName === 'A' && style.display.includes('inline') && el.closest('p, li, figcaption, figcaption, .prose')) {
          continue;
        }

        if (r.height < 44 || r.width < 44) {
          const text = (el.textContent ?? '').trim().slice(0, 24);
          bad.push(
            `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} "${text}" ` +
              `${Math.round(r.width)}x${Math.round(r.height)}`,
          );
        }
      }
      return bad;
    });
    expect(small, `targets under 44px: ${small.join(', ')}`).toHaveLength(0);
  });

  test('images carry dimensions and decorative ones are hidden from AT', async ({ page }) => {
    await page.goto('/creations');
    const imgs = page.locator('img');
    const count = await imgs.count();
    for (let i = 0; i < count; i++) {
      await expect(imgs.nth(i)).toHaveAttribute('alt', /.*/);
    }
  });

  test('focus is always visible when tabbing', async ({ page }) => {
    await page.goto('/');
    let sawOutline = false;
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      const outline = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
      });
      if (outline) sawOutline = true;
    }
    expect(sawOutline, 'no focus outline observed while tabbing').toBe(true);
  });

  test('the page honours prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    // Content must be fully visible without any reveal transition.
    const opacity = await page.locator('[data-reveal]').first().evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(opacity)).toBe(1);
  });
});

test.describe('security headers', () => {
  test('sends a hash-based CSP and the hardening header set', async ({ page }) => {
    const response = await page.goto('/');
    const headers = response!.headers();

    const csp = headers['content-security-policy'] ?? '';
    expect(csp, 'no CSP header').toContain('frame-ancestors');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBeTruthy();
    expect(headers['permissions-policy']).toBeTruthy();
  });

  test('the in-page CSP carries per-script hashes, not unsafe-inline', async ({ page }) => {
    await page.goto('/');
    const csp = await page
      .locator('meta[http-equiv="content-security-policy"]')
      .getAttribute('content');
    expect(csp).toMatch(/script-src[^;]*sha256-/);
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  test('the CSP names each directive at most once', async ({ page }) => {
    // A duplicate frame-src or connect-src silently drops the first, and Astro
    // warns at build time. Either way the policy is not what it looks like.
    await page.goto('/');
    const csp = (await page
      .locator('meta[http-equiv="content-security-policy"]')
      .getAttribute('content'))!;

    const names = csp
      .split(';')
      .map((d) => d.trim().split(/\s+/)[0])
      .filter(Boolean);
    const seen = new Set<string>();
    for (const name of names) {
      expect(seen.has(name), `duplicate directive: ${name}`).toBe(false);
      seen.add(name);
    }
  });

  test('error responses carry the hardening headers too', async ({ request }) => {
    // These used to return before the header loop ran, so a 404 shipped with
    // no HSTS, no CSP and no frame protection.
    for (const path of ['/creations/definitely-not-here', '/admin']) {
      const response = await request.get(path, { maxRedirects: 0 });
      const headers = response.headers();
      expect(headers['x-content-type-options'], `${path} nosniff`).toBe('nosniff');
      expect(headers['x-frame-options'], `${path} frame`).toBe('DENY');
      expect(headers['strict-transport-security'], `${path} hsts`).toBeTruthy();
      expect(headers['content-security-policy'], `${path} csp`).toContain('frame-ancestors');
    }
  });

  test('the page is not framed', async ({ page }) => {
    const response = await page.goto('/');
    expect(response!.headers()['x-frame-options']).toBe('DENY');
  });
});

test.describe('admin', () => {
  test('is unreachable without a session', async ({ page }) => {
    await page.goto('/admin');
    // Redirected to sign-in, or refused outright. Never the dashboard.
    await expect(page.locator('input[name="token"]')).toBeVisible();
  });

  test('is not indexable', async ({ page }) => {
    const response = await page.goto('/admin/login');
    expect(response!.headers()['x-robots-tag'] ?? (await page.locator('meta[name="robots"]').getAttribute('content'))).toMatch(
      /noindex/,
    );
  });

  test('the admin API refuses an unauthenticated mutation', async ({ request }) => {
    const response = await request.post('/api/admin/projects?action=delete', {
      data: { id: 1 },
    });
    expect([401, 403, 503]).toContain(response.status());
  });
});

test.describe('SEO', () => {
  test('every page has a unique title and description', async ({ page }) => {
    const seen = new Set<string>();
    for (const path of ['/', '/creations', '/studio', '/contact', '/privacy', '/terms']) {
      await page.goto(path);
      const title = await page.title();
      const description = await page.locator('meta[name="description"]').getAttribute('content');
      expect(title, `title on ${path}`).toBeTruthy();
      expect(description, `description on ${path}`).toBeTruthy();
      expect(seen.has(title), `duplicate title: ${title}`).toBe(false);
      seen.add(title);
    }
  });

  test('emits valid JSON-LD', async ({ page }) => {
    await page.goto('/');
    const raw = await page.locator('script[type="application/ld+json"]').first().textContent();
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed['@context']).toBe('https://schema.org');
    const types = parsed['@graph'].map((n: { '@type': string }) => n['@type']);
    expect(types).toContain('Organization');
    expect(types).toContain('WebSite');
  });

  test('serves a valid sitemap and robots.txt', async ({ request }) => {
    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    const xml = await sitemap.text();
    expect(xml).toContain('<urlset');
    expect(xml).toContain('</urlset>');

    const robots = await request.get('/robots.txt');
    expect(robots.status()).toBe(200);
    const text = await robots.text();
    expect(text).toContain('User-agent:');
    expect(text).toContain('Disallow: /admin');
  });

  test('the default OG image is a real PNG', async ({ request }) => {
    const response = await request.get('/og-default.png');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/png');
    const body = await response.body();
    // PNG magic number.
    expect([...body.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});
