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

/**
 * Teardown for the current page. ClientRouter swaps the document body but
 * keeps this module loaded, so without a teardown the old IntersectionObserver
 * would keep watching detached nodes and the new page's reveals would never be
 * observed — they would sit at opacity 0 until the failsafe.
 */
let dispose: (() => void) | null = null;

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
  dispose?.();
  dispose = null;

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
        const el = entry.target as HTMLElement;

        /* A section the reader scrolled PAST — fully above the viewport and
           still hidden. Momentum scrolling, anchor jumps and PgDn can move an
           element from below the fold to above it between two IO samples, so
           `isIntersecting` was never true for a single frame and the old
           callback skipped it: the section then stayed blank until the
           reader scrolled back up to meet it again. Reveal it now; it is
           off-screen, so no animation is needed and none plays. */
        if (!entry.isIntersecting) {
          if (entry.boundingClientRect.bottom <= 0) {
            io.unobserve(el);
            el.classList.add('is-revealed');
            el.style.transform = '';
            el.style.opacity = '';
          }
          continue;
        }

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

  /*
   * The scroll sweep, behind the observer.
   *
   * IO only delivers a record when an element's intersection *state* changes
   * against a threshold. An element that crosses from below the viewport to
   * above it without ever producing an intersecting sample — one long momentum
   * fling does exactly that — generates no record at all, so the callback
   * above cannot rescue what it is never told about. (The fast-capture audit,
   * 120 ms per screenful, left 30+ elements permanently hidden.)
   *
   * A rAF-throttled scroll listener covers the hole: it reads every
   * unrevealed element's rect in one batch — reads first, writes second, so
   * there is exactly one layout per scroll frame, not one per element — and
   * reveals anything fully above the fold. It removes itself once the list is
   * empty, because the common case (a reader who scrolls to the end) must not
   * pay for it afterwards.
   */
  let sweepPending = false;
  const sweep = () => {
    sweepPending = false;
    const missed = document.querySelectorAll<HTMLElement>('[data-reveal]:not(.is-revealed)');
    if (missed.length === 0) {
      window.removeEventListener('scroll', onSweepScroll);
      window.removeEventListener('resize', onSweepScroll);
      return;
    }
    /* One write per element AFTER all reads, so the batch costs one layout. */
    const above: HTMLElement[] = [];
    for (const el of missed) {
      if (el.getBoundingClientRect().bottom <= 0) above.push(el);
    }
    for (const el of above) {
      gsap.killTweensOf(el);
      el.classList.add('is-revealed');
      el.style.transform = '';
      el.style.opacity = '';
    }
  };
  const onSweepScroll = () => {
    if (sweepPending) return;
    sweepPending = true;
    requestAnimationFrame(sweep);
  };
  window.addEventListener('scroll', onSweepScroll, { passive: true });
  window.addEventListener('resize', onSweepScroll, { passive: true });
  sweep();

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
      hero.querySelector('.hero-figure'),
    ].filter((n): n is HTMLElement => n instanceof HTMLElement);

    const title = hero.querySelector<HTMLElement>('.hero__title');
    const words = title ? splitWords(title) : [];

    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

    if (words.length) {
      tl.from(words, { yPercent: 65, opacity: 0, duration: 0.9, stagger: 0.035 }, 0);
    }

    /* The title container carries `data-intro`: hidden from first byte so it
       never flashes visible before the word split. Revealed here in sync with
       the words, not separately, so the container never shows an empty frame.

       THIS MUST BE `gsap.to()`, NOT `gsap.from()`.

       `from()` animates FROM the values you give it TO whatever the element's
       current computed value happens to be. The resting CSS state for
       `[data-intro]` is `opacity: 0` (global.css) — so `from({ opacity: 0 })`
       animates 0 → 0 and the headline stays invisible forever. It shipped
       that way: the hero H1 rendered at opacity 0 on every load, and the
       reveal test passed because it ran under `prefers-reduced-motion`,
       where the media query forces opacity to 1 regardless.

       `to()` states the destination explicitly, so it is correct regardless
       of what the CSS resting state is. */
    const titleIntro = hero.querySelector('[data-intro]');
    if (titleIntro) {
      tl.to(titleIntro, { opacity: 1, y: 0, duration: 0.7 }, 0);
    }

    for (const [i, block] of blocks.entries()) {
      if (block.classList.contains('hero__title')) continue;
      tl.from(
        block,
        { y: 18, opacity: 0, duration: 0.7 },
        words.length ? 0.12 + i * 0.07 : i * 0.07,
      );
    }

    /* The blocks above are animated with `from()` because their resting CSS
       state is fully visible (opacity 1) — `from()` is correct there. The
       title container is the exception, and it is handled above.

       One more thing the `from()` calls get wrong on their own: they leave an
       inline `opacity: 0` on the element if the timeline is interrupted by a
       navigation before it completes, and the element then depends on the
       next pass to clean up. The `onComplete` handler hands every animated
       element back to CSS so a later media-query change can reposition it. */
    tl.eventCallback('onComplete', () => {
      for (const block of blocks) {
        block.style.opacity = '';
        block.style.transform = '';
      }
      const intro = hero.querySelector<HTMLElement>('[data-intro]');
      if (intro) {
        intro.classList.add('is-revealed');
        intro.style.opacity = '';
        intro.style.transform = '';
      }
      for (const word of hero.querySelectorAll<HTMLElement>('.word')) {
        word.style.opacity = '';
        word.style.transform = '';
      }
    });
  }

  /* -----------------------------------------------------------------------
     Scroll progress — the bar was cut from the masthead, and this driver was
     left behind: a scroll listener and an rAF write running on every route to
     style an element that no longer exists. Removed with it. If a progress
     bar ever returns, its driver returns with it.
     --------------------------------------------------------------------- */

  /* Safety net. The ordering above is designed to make a stuck reveal
     impossible, but "designed to" is not "impossible": if 2.5s after load an
     element that should already have settled is still at opacity 0, force it.

     It covers the hero entrance as well as the scroll reveals. The hero
     blocks are animated with `from()`, which sets their start state
     immediately — so if the timeline is interrupted (a navigation, a
     backgrounded tab that pauses rAF, a dropped frame budget) they are left
     sitting at opacity 0 with no CSS class to release them. The scroll
     reveals had a recovery path; the hero did not.

     Scoped to elements whose box is actually on screen, so a genuine IO
     failure cannot wipe out the scroll reveals still to come. */
  const heroBlocks = hero
    ? [
        hero.querySelector<HTMLElement>('.eyebrow'),
        hero.querySelector<HTMLElement>('.hero__title'),
        hero.querySelector<HTMLElement>('.hero__lede'),
        hero.querySelector<HTMLElement>('.hero__actions'),
        hero.querySelector<HTMLElement>('.hero__meta'),
        hero.querySelector<HTMLElement>('.hero-figure'),
      ].filter((n): n is HTMLElement => n !== null)
    : [];

  const timer = window.setTimeout(() => {
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

    /* The hero, same treatment. */
    const title = heroBlocks.find((el) => el.classList.contains('hero__title'));
    if (title && getComputedStyle(title).opacity !== '1') {
      gsap.killTweensOf(heroBlocks);
      for (const el of heroBlocks) {
        el.classList.add('is-revealed');
        el.style.opacity = '1';
        el.style.transform = 'none';
      }
      title.querySelectorAll<HTMLElement>('.word').forEach((word) => {
        word.style.opacity = '1';
        word.style.transform = 'none';
      });
    }
  }, 2500);

  dispose = () => {
    io.disconnect();
    window.removeEventListener('scroll', onSweepScroll);
    window.removeEventListener('resize', onSweepScroll);
    window.clearTimeout(timer);
    gsap.killTweensOf(reveals);
    gsap.killTweensOf(heroBlocks);
    // Clean any leftover inline styles from the word-split and hero intro.
    document.querySelectorAll('.word').forEach((el) => {
      (el as HTMLElement).style.opacity = '';
      (el as HTMLElement).style.transform = '';
    });
    document.querySelectorAll('.hero__title[data-intro]').forEach((el) => {
      (el as HTMLElement).style.opacity = '';
      (el as HTMLElement).style.transform = '';
    });
  };
}

/**
 * ClientRouter keeps this module alive across navigations, so the motion pass
 * has to be re-run per page. `astro:page-load` fires on first load and after
 * every swap; `astro:before-swap` tears the previous pass down first.
 */
function boot(): void {
  try {
    initMotion();
  } catch (error) {
    /* Reveal everything rather than leave a blank page. Swallowing here is
       deliberate — a motion failure must never take the content with it. */
    root.classList.add('no-motion');
    console.error('[motion]', error);
  }
}

document.addEventListener('astro:before-swap', () => {
  dispose?.();
  dispose = null;
});
document.addEventListener('astro:page-load', boot);
