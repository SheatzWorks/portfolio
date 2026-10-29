/**
 * Motion.
 *
 * GSAP core only — no ScrollTrigger. Scroll-triggered entrances are driven by
 * an IntersectionObserver instead, because a viewport-crossing test is one
 * line and costs nothing to keep in sync, while ScrollTrigger's value is in
 * pinning and scrubbing, neither of which this site does.
 *
 * ---
 *
 * THE BUG THIS FILE EXISTS TO FIX:
 *
 * global.css has always had `[data-reveal] { opacity: 0 }` with a `.is-revealed`
 * override, and Base.astro removed the `no-js` class — but nothing ever added
 * `.is-revealed`. Every section head, service row, process step, practice
 * statement, stack group and FAQ on all five pages was permanently invisible:
 * 84 elements at opacity 0. The one test covering reveal ran under
 * `prefers-reduced-motion: reduce`, where a media query forces them visible, so
 * it passed while the site shipped blank.
 *
 * Order of operations matters here:
 *
 *   1. `[data-reveal]` is hidden by CSS from the first byte, so content never
 *      paints visible and then vanishes (the flip that used to happen at the
 *      end of <body> was a real flicker window).
 *   2. This module adds `.motion-ready` only once an IntersectionObserver is
 *      actually observing — which cancels the 3s failsafe in global.css.
 *   3. If the bundle never arrives, `.motion-ready` never appears and the
 *      failsafe reveals everything on its own.
 *   4. If this code throws, the catch adds `.no-motion`, which reveals
 *      immediately rather than waiting out the timer.
 *
 * So a 404 on this bundle costs three seconds, and an exception costs none.
 * Neither costs the content.
 */
import { gsap } from 'gsap';

const REDUCED = '(prefers-reduced-motion: reduce)';

const root = document.documentElement;

function revealAll(): void {
  root.classList.add('no-motion');
  document.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => {
    el.classList.add('is-revealed');
    el.style.opacity = '';
    el.style.transform = '';
  });
}

/** Word-split the hero heading so the entrance can stagger line by line. */
function splitWords(el: HTMLElement): HTMLElement[] {
  const words = (el.textContent ?? '').split(/(\s+)/);
  const frag = document.createDocumentFragment();
  const spans: HTMLElement[] = [];
  for (const chunk of words) {
    if (!chunk) continue;
    if (!chunk.trim()) {
      frag.appendChild(document.createTextNode(chunk));
      continue;
    }
    const span = document.createElement('span');
    span.className = 'word';
    span.textContent = chunk;
    frag.appendChild(span);
    spans.push(span);
  }
  el.textContent = '';
  el.appendChild(frag);
  return spans;
}

export function initMotion(): void {
  const reveals = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));

  /* -----------------------------------------------------------------------
     Reduced motion: no entrance choreography at all. The CSS already forces
     `[data-reveal]` visible under this query; this only stops GSAP from
     queueing work that will be discarded.
     --------------------------------------------------------------------- */
  if (window.matchMedia(REDUCED).matches) {
    revealAll();
    return;
  }

  if (!('IntersectionObserver' in window)) {
    revealAll();
    return;
  }

  /* -----------------------------------------------------------------------
     Scroll reveal.
     Grouped by section: the first element of a section crossing the
     threshold reveals the whole section in a 55ms cascade. Revealing elements
     one at a time as each hits the fold looks like the page is being
     assembled; revealing by section looks like the section arriving.
     --------------------------------------------------------------------- */
  const order = new Map<HTMLElement, number>();
  const bySection = new Map<Element, number>();

  for (const el of reveals) {
    const section = el.closest('section') ?? el.parentElement ?? document.body;
    const i = bySection.get(section) ?? 0;
    /* Capped so a section with 20 children does not take a second to finish
       arriving. */
    order.set(el, Math.min(i, 7));
    bySection.set(section, i + 1);
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        io.unobserve(el);
        gsap.to(el, {
          opacity: 1,
          y: 0,
          duration: 0.75,
          delay: (order.get(el) ?? 0) * 0.055,
          ease: 'power3.out',
          overwrite: 'auto',
          onComplete: () => {
            el.classList.add('is-revealed');
            /* Hand the box back to CSS. Leaving an inline transform around
               means a later media-query change cannot reposition it. */
            el.style.transform = '';
            el.style.opacity = '';
          },
        });
      }
    },
    { rootMargin: '0px 0px -6% 0px', threshold: 0.01 },
  );

  for (const el of reveals) io.observe(el);

  /* Report in. This is what cancels the 3s failsafe, so it has to happen only
     once observers are attached — taking it earlier would arm the very timer
     it is meant to disarm, and the page would jump to fully-revealed at 3s. */
  root.classList.add('motion-ready');

  /* -----------------------------------------------------------------------
     Hero entrance.
     Runs once, immediately, because the hero is never below the fold. Blocks
     only — no per-character split, which is the construction that reads as
     a template the moment it is slow.
     --------------------------------------------------------------------- */
  const hero = document.querySelector<HTMLElement>('.hero');
  if (hero) {
    const blocks = [
      hero.querySelector('.eyebrow'),
      hero.querySelector('.hero__title'),
      hero.querySelector('.hero__lede'),
      hero.querySelector('.hero__actions'),
      hero.querySelector('.hero__meta'),
      hero.querySelector('.product-card'),
    ].filter((n): n is HTMLElement => n instanceof HTMLElement);

    const title = hero.querySelector<HTMLElement>('.hero__title');
    const words = title ? splitWords(title) : [];

    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

    if (words.length) {
      tl.from(words, { yPercent: 65, opacity: 0, duration: 0.9, stagger: 0.035 }, 0);
    }

    for (const [i, block] of blocks.entries()) {
      if (block.classList.contains('hero__title')) continue;
      tl.from(
        block,
        { y: 18, opacity: 0, duration: 0.7 },
        words.length ? 0.12 + i * 0.07 : i * 0.07,
      );
    }
  }

  /* -----------------------------------------------------------------------
     Scroll progress.
     rAF-throttled: a scroll listener that writes to the DOM on every event
     will jank on a phone, and this runs on every route.
     --------------------------------------------------------------------- */
  const bar = document.querySelector<HTMLElement>('.scroll-progress');
  if (bar) {
    let ticking = false;
    const update = () => {
      const max = root.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      bar.style.setProperty('--progress', String(Math.round(p * 1000) / 1000));
      ticking = false;
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  }

  /* Safety net. The ordering above is designed to make a stuck reveal
     impossible, but "designed to" is not "impossible": if 2.5s after load an
     element that should already have settled is still at opacity 0, force it.
     Scoped to elements whose box is actually on screen so a genuine IO failure
     cannot wipe out the scroll reveals still to come. */
  window.setTimeout(() => {
    document
      .querySelectorAll<HTMLElement>('[data-reveal]:not(.is-revealed)')
      .forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.top >= window.innerHeight || rect.bottom <= 0) return;
        gsap.killTweensOf(el);
        el.classList.add('is-revealed');
        el.style.opacity = '1';
        el.style.transform = 'none';
      });
  }, 2500);
}

try {
  initMotion();
} catch (error) {
  /* Reveal everything rather than leave a blank page. Swallowing here is
     deliberate — a motion failure must never take the content with it. */
  root.classList.add('no-motion');
  console.error('[motion]', error);
}
