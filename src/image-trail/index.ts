// Image-trail cursor effect — the GSAP thumbnail trail that follows the
// pointer. Extracted from vshslv.com (src/scripts/home/image-trail.ts) as a
// standalone module for reuse on another site.
//
// This file is the thin OWNER: it builds the shared TrailCtx, composes the
// subsystems on it, does the mount lookup + image-load wait, binds the pointer
// listeners once the images load, and registers teardown on signal abort.
// The behaviour is split across —
//   config.ts    — tuning constants + the dismissDelay / isMobileViewport leaves
//   context.ts   — the shared TrailCtx interface + the host TrailHooks
//   pool.ts      — the thumbnail reuse pool (ImageEl + ImageTrailInstance)
//   dismissal.ts — the per-thumb clear + host copy hide/reveal (via hooks)
//   toggle.ts    — the on/off flip
//   input.ts     — mouse + touch pointer handlers
//
// Deltas from the vshslv.com original (documented per its "reuse in full"
// rule): the hero-copy typewriter + bg-video promote are replaced by the
// TrailHooks pair (the host page reacts its own way); the `trail-hero` window
// event + the .toggle_wrap knob lookup are gone (toggle is driven through the
// returned API); isOverlayUp() gates removed (no overlays here).

import { gsap } from "gsap";
import { isTouchDevice } from "../shared/device-detection.ts";
import type { TrailCtx, TrailHooks } from "./context.ts";
import { ImageTrailInstance } from "./pool.ts";
import { setupDismissal } from "./dismissal.ts";
import { setupToggle } from "./toggle.ts";
import { setupInput } from "./input.ts";
import { setupMaskLayer } from "./mask-layer.ts";

export type { TrailHooks } from "./context.ts";

export interface TrailApi {
  /** Flip the trail on/off — folds the on-screen trail away / resumes it. */
  handleToggle(): void;
}

export function setupImageTrail(
  signal: AbortSignal,
  hooks: TrailHooks
): TrailApi {
  const ctx: TrailCtx = {
    imageTrail: null,
    hooks,
    signal,
    mousePos: { x: 0, y: 0 },
    lastMousePos: { x: 0, y: 0 },
    pointerSeeded: false,
    isIdle: false,
    idleTimer: null,
    hideGeneration: 0,
    heroHidden: false,
    hideQuickly: false,
    isHidingImages: false,
    animationPaused: false,
    isToggling: false,
    toggleResetTimer: null,
  };

  // Compose the subsystems on the shared ctx — acyclic, dependencies explicit:
  // toggle + input both borrow from dismissal (its foldOut / hide ops).
  const dismissal = setupDismissal(ctx);
  const { handleToggle } = setupToggle(ctx, dismissal);
  const input = setupInput(ctx, dismissal);

  // Wire the pointer listeners. Deferred until the trail's images load (see
  // init below) so a wandering early move can't spawn against an unbuilt pool.
  // All listeners carry `{ signal }`, so the abort auto-removes them.
  const bindEvents = (): void => {
    // [MASK] The card painter — one hidden mask video + one canvas that draws
    // the cover-mapped slice of it into every visible card box (the boxes
    // themselves are empty geometry proxies).
    setupMaskLayer(ctx);

    if (isTouchDevice()) {
      document.body.addEventListener("touchstart", input.touchStart, {
        passive: false,
        signal,
      });
      document.body.addEventListener("touchmove", input.touchMove, {
        passive: false,
        signal,
      });
      document.body.addEventListener("touchend", input.touchEnd, {
        passive: true,
        signal,
      });
    } else {
      document.body.addEventListener("mousemove", input.mouseMove, { signal });
    }
  };

  // init: find the mount, build the pool once every thumbnail has loaded (so the
  // first reveal measures real rects), then bind events. No mount → handleToggle
  // still works (state + event), it just never spawns thumbs.
  const contentElement = document.querySelector<HTMLElement>(".image-wrap");
  if (contentElement) {
    const images = document.querySelectorAll<HTMLImageElement>(
      ".content__img-inner"
    );
    let loadedImages = 0;
    const onImagesLoaded = (): void => {
      loadedImages++;
      if (loadedImages === images.length) {
        ctx.imageTrail = new ImageTrailInstance(contentElement);
        bindEvents();
      }
    };

    if (images.length === 0) {
      ctx.imageTrail = new ImageTrailInstance(contentElement);
      bindEvents();
    } else {
      images.forEach((img) => {
        if (img.complete) onImagesLoaded();
        else {
          img.addEventListener("load", onImagesLoaded, { signal });
          img.addEventListener("error", onImagesLoaded, { signal });
        }
      });
    }
  }

  // Teardown (the host aborts the signal): the `{ signal }` on every listener
  // auto-removes them, so this only kills the in-flight tweens + timers.
  signal.addEventListener("abort", () => {
    if (ctx.idleTimer) clearTimeout(ctx.idleTimer);
    if (ctx.toggleResetTimer) clearTimeout(ctx.toggleResetTimer);
    gsap.killTweensOf(".content__img");
  });

  return { handleToggle };
}
