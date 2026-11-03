/**
 * Motion — native Web Animations API (no GSAP).
 *
 * Replaces GSAP with native element.animate() for scroll reveals and hero entrance.
 * Keeps the same behavioural contract: IntersectionObserver for reveals, rAF sweep
 * for fast-scroll edge cases, 3s failsafe in global.css, word-split stagger for hero.
 */

const REDUCED = '(prefers-reduced-motion: reduce)';
const root = document.documentElement;

/** Easing equivalent to GSAP's "power3.out" ≈ cubic-bezier(0.215, 0.61, 0.355, 1) */
const EASE_OUT = 'cubic-bezier(0.215, 0.61, 0.355, 1)';

/** Teardown for the current page. ClientRouter swaps the document body but
 *  keeps this module loaded, so without a teardown the old IntersectionObserver
 *  would keep watching detached nodes and the new page's reveals would never be
 *  observed — they would sit at opacity 0 until the failsafe. */
let dispose: (() => void) | null = null;

/** Track active animations for cleanup. */
const activeAnimations = new Map<HTMLElement, Animation[]>();

function revealAll(): void {
  root.classList.add('no-motion');
  document.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => {
    el.classList.add('is-revealed');
    el.style.opacity = '';
    el.style.transform = '';
  });
  // Cancel any in-flight animations
  activeAnimations.forEach((anims) => anims.forEach((a) => a.cancel()));
  activeAnimations.clear();
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

/** Register an animation for later cleanup. */
function track(el: HTMLElement, anim: Animation): void {
  const arr = activeAnimations.get(el) ?? [];
  arr.push(anim);
  activeAnimations.set(el, arr);
  anim.onfinish = () => {
    const a = activeAnimations.get(el);
    if (a) {
      const i = a.indexOf(anim);
      if (i >= 0) a.splice(i, 1);
      if (a.length === 0) activeAnimations.delete(el);
    }
  };
  anim.oncancel = () => {
    const a = activeAnimations.get(el);
    if (a) {
      const i = a.indexOf(anim);
      if (i >= 0) a.splice(i, 1);
      if (a.length === 0) activeAnimations.delete(el);
    }
  };
}

/** Kill all tracked animations on an element. */
function killTweensOf(el: HTMLElement): void {
  const anims = activeAnimations.get(el);
  if (anims) {
    anims.forEach((a) => a.cancel());
    activeAnimations.delete(el);
  }
}

export function initMotion(): void {
  dispose?.();
  dispose = null;

  const reveals = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));

  /* -----------------------------------------------------------------------
     Reduced motion: no entrance choreography at all. The CSS already forces
     `[data-reveal]` visible under this query; this only stops us from
     queueing work that will be discarded.
     -------------------------------------------------------------------- */
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
     threshold reveals the whole section in a 55ms cascade.
     -------------------------------------------------------------------- */
  const order = new Map<HTMLElement, number>();
  const bySection = new Map<Element, number>();

  for (const el of reveals) {
    const section = el.closest('section') ?? el.parentElement ?? document.body;
    const i = bySection.get(section) ?? 0;
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

        const delay = (order.get(el) ?? 0) * 55; // ms
        const anim = el.animate(
          [
            { opacity: 0, transform: 'translateY(12px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          {
            duration: 750,
            delay,
            easing: EASE_OUT,
            fill: 'forwards',
          }
        );

        track(el, anim);
        anim.onfinish = () => {
          el.classList.add('is-revealed');
          el.style.transform = '';
          el.style.opacity = '';
          // Clean up tracking
          const a = activeAnimations.get(el);
          if (a) {
            const i = a.indexOf(anim);
            if (i >= 0) a.splice(i, 1);
            if (a.length === 0) activeAnimations.delete(el);
          }
        };
      }
    },
    { rootMargin: '0px 0px -6% 0px', threshold: 0.01 },
  );

  for (const el of reveals) io.observe(el);

  /* -----------------------------------------------------------------------
     Scroll sweep — catches elements that momentum-scrolled past the fold
     without ever producing an intersecting IO sample.
     -------------------------------------------------------------------- */
  let sweepPending = false;
  const sweep = () => {
    sweepPending = false;
    const missed = document.querySelectorAll<HTMLElement>('[data-reveal]:not(.is-revealed)');
    if (missed.length === 0) {
      window.removeEventListener('scroll', onSweepScroll);
      window.removeEventListener('resize', onSweepScroll);
      return;
    }
    const above: HTMLElement[] = [];
    for (const el of missed) {
      if (el.getBoundingClientRect().bottom <= 0) above.push(el);
    }
    for (const el of above) {
      killTweensOf(el);
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

  /* Report in — cancels the 3s failsafe in global.css. */
  root.classList.add('motion-ready');

  /* -----------------------------------------------------------------------
     Hero entrance.
     Runs once, immediately, because the hero is never below the fold.
     -------------------------------------------------------------------- */
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

    // Word stagger for hero title
    if (words.length) {
      words.forEach((word, i) => {
        const anim = word.animate(
          [
            { opacity: 0, transform: 'translateY(65%)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          {
            duration: 900,
            delay: i * 35,
            easing: EASE_OUT,
            fill: 'forwards',
          }
        );
        track(word, anim);
      });
    }

    // Title container (data-intro) — must use `to` semantics (opacity 0 → 1)
    const titleIntro = hero.querySelector<HTMLElement>('[data-intro]');
    if (titleIntro) {
      const anim = titleIntro.animate(
        [
          { opacity: 0, transform: 'translateY(12px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        {
          duration: 700,
          delay: words.length ? 120 : 0,
          easing: EASE_OUT,
          fill: 'forwards',
        }
      );
      track(titleIntro, anim);
      anim.onfinish = () => {
        titleIntro.classList.add('is-revealed');
        titleIntro.style.opacity = '';
        titleIntro.style.transform = '';
      };
    }

    // Other hero blocks
    for (const [i, block] of blocks.entries()) {
      if (block.classList.contains('hero__title')) continue;
      const delay = words.length ? 120 + i * 70 : i * 70;
      const anim = block.animate(
        [
          { opacity: 0, transform: 'translateY(18px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        {
          duration: 700,
          delay,
          easing: EASE_OUT,
          fill: 'forwards',
        }
      );
      track(block, anim);
      anim.onfinish = () => {
        block.style.opacity = '';
        block.style.transform = '';
      };
    }

    // Hero cleanup on complete
    const heroBlocks = [
      hero.querySelector<HTMLElement>('.eyebrow'),
      hero.querySelector<HTMLElement>('.hero__title'),
      hero.querySelector<HTMLElement>('.hero__lede'),
      hero.querySelector<HTMLElement>('.hero__actions'),
      hero.querySelector<HTMLElement>('.hero__meta'),
      hero.querySelector<HTMLElement>('.hero-figure'),
    ].filter((n): n is HTMLElement => n !== null);

    // Ensure word spans and title intro get cleaned up
    Promise.all([
      ...words.map((w) => w.getAnimations()[0]?.finished),
      titleIntro?.getAnimations()[0]?.finished,
    ]).then(() => {
      for (const block of heroBlocks) {
        block.style.opacity = '';
        block.style.transform = '';
      }
      if (titleIntro) {
        titleIntro.classList.add('is-revealed');
        titleIntro.style.opacity = '';
        titleIntro.style.transform = '';
      }
      for (const word of hero.querySelectorAll<HTMLElement>('.word')) {
        word.style.opacity = '';
        word.style.transform = '';
      }
    });
  }

  /* -----------------------------------------------------------------------
     Safety net — 2.5s after load, force-reveal anything on-screen that's
     still hidden. Covers both hero and scroll reveals.
     -------------------------------------------------------------------- */
  const timer = window.setTimeout(() => {
    document
      .querySelectorAll<HTMLElement>('[data-reveal]:not(.is-revealed)')
      .forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.top >= window.innerHeight || rect.bottom <= 0) return;
        killTweensOf(el);
        el.classList.add('is-revealed');
        el.style.opacity = '1';
        el.style.transform = 'none';
      });

    // Hero blocks same treatment
    const heroBlocks = [
      hero?.querySelector<HTMLElement>('.eyebrow'),
      hero?.querySelector<HTMLElement>('.hero__title'),
      hero?.querySelector<HTMLElement>('.hero__lede'),
      hero?.querySelector<HTMLElement>('.hero__actions'),
      hero?.querySelector<HTMLElement>('.hero__meta'),
      hero?.querySelector<HTMLElement>('.hero-figure'),
    ].filter((n): n is HTMLElement => n !== null);

    const title = heroBlocks.find((el) => el.classList.contains('hero__title'));
    if (title && getComputedStyle(title).opacity !== '1') {
      for (const el of heroBlocks) {
        killTweensOf(el);
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
    // Cancel all tracked animations
    activeAnimations.forEach((anims) => anims.forEach((a) => a.cancel()));
    activeAnimations.clear();
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
    root.classList.add('no-motion');
    console.error('[motion]', error);
  }
}

document.addEventListener('astro:before-swap', () => {
  dispose?.();
  dispose = null;
});
document.addEventListener('astro:page-load', boot);