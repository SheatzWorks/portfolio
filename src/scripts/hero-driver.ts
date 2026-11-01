/**
 * The hero driver.
 *
 * DESIGN.md section 4, the motion contract: ONE module owns pointer position
 * (normalised -1…1) and hero scroll progress (0…1), and both the figure and
 * the hero type read from the same two numbers, so nothing on screen
 * disagrees. Before this existed the hero type did entrance choreography only
 * — the figure answered the pointer and the words sat still, and the two
 * halves of the hero disagreed about whether the page was alive.
 *
 * What it owns:
 *
 *   --hero-x, --hero-y      pointer position over the hero, -1…1 both axes
 *   --hero-scroll           how far the hero has scrolled out, 0…1
 *
 * What consumes them (components.css):
 *
 *   .hero__intro            the type drifts a few px, away from the pointer
 *   .hero-figure__drift     the figure drifts the other way, and lifts as the
 *                           hero scrolls out — the two motions are one system
 *
 * Behavioural rules, from the same contract:
 *
 *   * Mounts only on (pointer: fine) with prefers-reduced-motion: no-preference
 *     and JS on. Touch and reduced-motion visitors get the static composed
 *     frame, at the same geometry, with the variables unset — which resolves
 *     to an identity transform, so nothing moves and nothing can break.
 *   * No layout is ever read or written in the hot path. The hero rect is
 *     measured once per mount (and on resize), and every frame writes two
 *     custom properties on one element — a style recalc, never a reflow.
 *   * Idle: after two seconds without pointer movement the values ease toward
 *     a slow sine drift, so the hero keeps breathing with the pointer still.
 *     DESIGN.md's acceptance check is five seconds; two keeps the handover
 *     from pointer-to-idle invisible.
 *   * Values are eased with a per-frame lerp rather than snapped, so a
 *     pointer entering the window starts from rest and a swipe cannot jump
 *     the type.
 *
 * Consumers subscribe with `subscribe()`; the figure uses the same numbers to
 * modulate its own intensity, so even the drawing inside the stage answers
 * the driver that the type answers.
 */

export interface HeroDriverValues {
  /** Pointer over the hero, -1…1 on x (left → right). */
  x: number;
  /** Pointer over the hero, -1…1 on y (top → bottom). */
  y: number;
  /** Hero scroll progress, 0 (top of page) → 1 (hero fully scrolled out). */
  scroll: number;
}

export interface HeroDriver {
  /** Stop listening and disconnect. Safe to call twice. */
  destroy(): void;
  /**
   * Observe every eased write. Returns an unsubscribe function. The callback
   * runs inside the driver's rAF loop — keep it allocation-free.
   */
  subscribe(fn: (values: HeroDriverValues) => void): () => void;
}

const REDUCED = '(prefers-reduced-motion: reduce)';
const FINE = '(pointer: fine)';

/** Seconds without pointer movement before the sine drift takes over. */
const IDLE_AFTER_MS = 2000;
/** Per-frame easing factor. Small enough that a swipe cannot jump the type. */
const EASE = 0.075;
/** How far the idle sine may travel, in normalised units. */
const IDLE_AMPLITUDE = 0.32;
/** Idle periods (seconds) — deliberately incommensurate so the drift never loops visibly. */
const IDLE_RATE_X = 0.34;
const IDLE_RATE_Y = 0.27;

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

export function mountHeroDriver(hero: HTMLElement): HeroDriver | null {
  /* Touch and reduced-motion: the static composed frame is the design, not a
     fallback, and it must not be given a driver it cannot see. */
  if (window.matchMedia(REDUCED).matches) return null;
  if (!window.matchMedia(FINE).matches) return null;

  const abort = new AbortController();
  const { signal } = abort;

  /* --- measured once, invalidated on resize ----------------------------- */
  let rect = hero.getBoundingClientRect();

  /* --- current (eased) and target values -------------------------------- */
  let x = 0;
  let y = 0;
  let scroll = 0;
  let targetX = 0;
  let targetY = 0;
  let lastMove = 0;

  /* --- listeners -------------------------------------------------------- */
  const onPointerMove = (event: PointerEvent) => {
    /* Normalised against the hero's own box, so the drift is about the hero,
       not about the window — moving the pointer down the page below the hero
       must not keep pulling the type. */
    targetX = clamp(((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1, -1, 1);
    targetY = clamp(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1, -1, 1);
    lastMove = performance.now();
  };

  const onScroll = () => {
    /* rAF-throttled: the write happens in the main loop below, so this only
       marks the frame dirty. */
    pendingScroll = true;
  };

  const onResize = () => {
    rect = hero.getBoundingClientRect();
    pendingScroll = true;
  };

  let pendingScroll = true;
  let raf = 0;

  window.addEventListener('pointermove', onPointerMove, { passive: true, signal });
  window.addEventListener('scroll', onScroll, { passive: true, signal });
  window.addEventListener('resize', onResize, { passive: true, signal });

  /* --- subscribers ------------------------------------------------------ */
  const subscribers = new Set<(values: HeroDriverValues) => void>();

  const readScroll = (): number => {
    /* How far through the hero the page has travelled: 0 at rest, 1 when the
       hero's bottom edge has reached the top of the viewport. Rect-based so
       it stays correct wherever the hero sits in the document.

       `rect` is measured at whatever scroll position happened to be current
       when it was taken, so the hero's document-space top — what scroll
       progress must be compared against — is `rect.top + window.scrollY`.
       A `−` sign here recorded a value shifted by twice the measurement
       offset: after a resize mid-page, scrolling back to the top left
       `--hero-scroll` pinned at 1 and the figure held at full lift while
       fully on screen. */
    const top = rect.top + window.scrollY;
    const travel = Math.max(1, rect.height);
    return clamp((window.scrollY - top) / travel, 0, 1);
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);

    if (pendingScroll) {
      scroll = readScroll();
      pendingScroll = false;
    }

    /* Idle: ease toward the sine drift. Moving again simply re-targets the
       pointer values; the same lerp hands control back without a snap. */
    if (now - lastMove > IDLE_AFTER_MS) {
      const t = now / 1000;
      targetX = Math.sin(t * IDLE_RATE_X) * IDLE_AMPLITUDE;
      targetY = Math.cos(t * IDLE_RATE_Y) * IDLE_AMPLITUDE;
    }

    x += (targetX - x) * EASE;
    y += (targetY - y) * EASE;

    hero.style.setProperty('--hero-x', x.toFixed(4));
    hero.style.setProperty('--hero-y', y.toFixed(4));
    hero.style.setProperty('--hero-scroll', scroll.toFixed(4));

    for (const fn of subscribers) fn({ x, y, scroll });
  };

  raf = requestAnimationFrame(frame);

  return {
    destroy() {
      abort.abort();
      cancelAnimationFrame(raf);
      subscribers.clear();
      /* Hand the element back to CSS with the variables unset — the stylesheet
         fallbacks (0) are the identity transform, so teardown is invisible. */
      hero.style.removeProperty('--hero-x');
      hero.style.removeProperty('--hero-y');
      hero.style.removeProperty('--hero-scroll');
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
