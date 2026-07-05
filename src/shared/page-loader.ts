// Page "ready" signal + the first-paint loader. Copied from vshslv.com
// src/scripts/shared/page-loader.ts (deltas: import paths; the loader markup
// lives in index.html instead of Shell.astro; no soft-nav cycle existed there
// either, so the logic is unchanged).
//
// The visual is a BLACK first-paint cover (.loader, style.css) with a single
// 1px line that sweeps left→right along the 45svh hero line. On completion it
// drops the cover (add .loader--done) and fires the `loaderFinished` event
// CONTRACT — the single signal every reveal waits on (here: the ASCII "develop"
// in ascii-video(.webgl).ts, gated so the glyphs don't develop UNDER the black
// cover). Dropping the cover reveals an identical black backdrop underneath
// (body base + the develop's black start state), so the handoff is seamless.
//
// `window.loaderFinished` stays the sticky late-mount flag (set once, never
// cleared).

import { gsap } from "gsap";
import { prefersReducedMotion } from "./device-detection.ts";
import { OPEN_EASE, OPEN_S } from "./overlay-ease.ts";

// The bar sweeps with the SHARED overlay-open motion: OPEN_EASE — the
// micro-pause "freeze and present" curve (a flat 0.5→0.5 hold at 26%→65% of
// the timeline) — over OPEN_S. Reused from the one source of truth, not
// re-specified here.
//
// Absolute ceiling. GSAP advances on rAF, which is SUSPENDED while the tab is
// backgrounded — so if the page loads hidden the bar tween never runs and its
// onComplete never fires, stranding the reveal (black cover never dropped).
// setTimeout keeps ticking while hidden; whichever path reaches the finish
// first is idempotent.
const MAX_MS = OPEN_S * 1000 + 2500;

declare global {
  interface Window {
    loaderFinished?: boolean;
  }
}

function fire(): void {
  if (window.loaderFinished) return;
  window.loaderFinished = true;
  window.dispatchEvent(new Event("loaderFinished"));
}

// Gate a callback on the loaderFinished contract — fire immediately if it
// already happened (sticky flag), else once when the event dispatches. The
// ASCII develop (ascii-video.ts / ascii-video-webgl.ts) uses this to hold the
// glyph reveal until the bar completes.
export function onLoaderFinished(cb: () => void, signal?: AbortSignal): void {
  if (window.loaderFinished) {
    cb();
    return;
  }
  window.addEventListener("loaderFinished", cb, { once: true, signal });
}

// First-paint fire, used only when there's NO .loader in the DOM: fire after
// first paint (DCL → two rAFs) so every reveal listener registered on
// DOMContentLoaded is in place to catch it, with rAF-independent backstops for
// a tab that loads hidden.
function scheduleFirstPaintFire(): void {
  requestAnimationFrame(() => requestAnimationFrame(fire));
  if (document.visibilityState === "hidden") {
    const onVisible = (): void => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", onVisible);
      fire();
    };
    document.addEventListener("visibilitychange", onVisible);
    setTimeout(fire, 1200);
  }
}

export function setupPageLoader(): void {
  const start = (): void => {
    const loader = document.querySelector<HTMLElement>(".loader");
    const progress = loader?.querySelector<HTMLElement>(".loader_progress") ?? null;

    // No loader element → keep the first-paint reveal.
    if (!loader || !progress) {
      scheduleFirstPaintFire();
      return;
    }

    // Reduced motion — no bar sweep: drop the black cover and un-gate every
    // reveal at once. The ASCII intro also shows the video with no develop
    // under reduced motion, so this is a clean instant cut.
    if (prefersReducedMotion()) {
      loader.classList.add("loader--done");
      fire();
      return;
    }

    // Absolute backstop for a tab that loads backgrounded (see MAX_MS).
    // Idempotent with the tween's onComplete — whichever wins first, the other
    // no-ops.
    const backstop = window.setTimeout(() => {
      loader.classList.add("loader--done");
      fire();
    }, MAX_MS);

    // The pixel line runs left→right via scaleX 0→1 (grown from the left inset;
    // scaleY(0.5) + transform-origin come from style.css, re-affirmed here so
    // GSAP's transform cache keeps the crisp 0.5 y-scale while it animates x).
    // On completion: drop the (identical-black) cover, cancel the backstop, and
    // fire the contract → the ASCII develop plays from here.
    gsap.set(progress, { scaleY: 0.5, transformOrigin: "left top" });
    gsap.fromTo(
      progress,
      { scaleX: 0 },
      {
        scaleX: 1,
        duration: OPEN_S,
        ease: OPEN_EASE,
        onComplete: () => {
          window.clearTimeout(backstop);
          loader.classList.add("loader--done");
          fire();
        },
      }
    );
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}
