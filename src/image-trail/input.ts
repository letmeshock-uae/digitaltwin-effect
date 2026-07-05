// Pointer input for the image-trail: mouse (desktop) + touch (mobile).
// Each move past the reveal threshold spawns the next thumb at the cursor; the
// first spawn hides the host copy, and a rest schedules the idle clear.
// The owner binds these handlers AFTER the trail's images load (so a wandering
// early move can't spawn against an unbuilt pool). Borrows hideHeroContent /
// hideImagesSequentially from dismissal (passed in explicitly).
//
// Copied from vshslv.com src/scripts/home/image-trail/input.ts; the one delta
// is the removed isOverlayUp() gate (that site's modal/terminal overlay check)
// — reintroduce it in the handler guards if the target site grows an overlay.

import type { TrailCtx } from "./context.ts";
import type { DismissalApi } from "./dismissal.ts";
import { TRAIL_DISTANCE, TRAIL_DISTANCE_TOUCH } from "./config.ts";

export interface InputApi {
  mouseMove(e: MouseEvent): void;
  touchStart(e: TouchEvent): void;
  touchMove(e: TouchEvent): void;
  touchEnd(e: TouchEvent): void;
}

export function setupInput(ctx: TrailCtx, dismissal: DismissalApi): InputApi {
  function handleTouchStart(e: TouchEvent): void {
    if (!ctx.imageTrail || ctx.animationPaused || ctx.isToggling) return;
    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;
    ctx.mousePos = { x, y };
    ctx.lastMousePos = { x, y };
    if (ctx.isHidingImages) {
      ctx.hideGeneration++;
      ctx.isHidingImages = false;
    }
    // The host copy collapses on the first real draw (touchmove past the
    // threshold below), mirroring the desktop first-thumb collapse — not on a
    // bare touchstart.
  }

  // Cursor-style trail for touch: every time the finger crosses
  // TRAIL_DISTANCE_TOUCH px (measured in mapped coords) the next image
  // appears at the mapped position. Drawing a figure-8 in the bottom
  // half paints it across the whole viewport. Keep interactive controls
  // OUTSIDE the trail surface (or pointer-events: auto siblings) so the
  // draw never competes with taps.
  function handleTouchMove(e: TouchEvent): void {
    if (!ctx.imageTrail || ctx.animationPaused || ctx.isToggling) return;
    if (e.cancelable) e.preventDefault();
    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;
    ctx.mousePos = { x, y };

    if (ctx.idleTimer) clearTimeout(ctx.idleTimer);
    ctx.isIdle = false;

    if (ctx.isHidingImages) {
      ctx.hideGeneration++;
      ctx.isHidingImages = false;
    }

    const distance = Math.hypot(x - ctx.lastMousePos.x, y - ctx.lastMousePos.y);
    if (distance > TRAIL_DISTANCE_TOUCH) {
      // First real draw collapses the host copy, the same as the desktop
      // mouse path.
      if (!ctx.heroHidden) dismissal.hideHeroContent();
      ctx.imageTrail.showNextImage(ctx.mousePos);
      ctx.lastMousePos = { x, y };
    }
  }

  function handleTouchEnd(_e: TouchEvent): void {
    if (ctx.isToggling) return;
    if (ctx.idleTimer) clearTimeout(ctx.idleTimer);
    // Short idle — trail clears quickly so successive draws feel
    // responsive. hideQuickly trims the per-image stagger inside
    // hideImagesSequentially.
    ctx.hideQuickly = true;
    ctx.idleTimer = setTimeout(() => {
      dismissal.hideImagesSequentially();
      ctx.isIdle = true;
    }, 500);
  }

  function handleMouseMove(e: MouseEvent): void {
    if (!ctx.imageTrail || ctx.animationPaused || ctx.isToggling) return;
    ctx.mousePos = { x: e.clientX, y: e.clientY };
    processMovement(e.clientX, e.clientY);
  }

  function processMovement(x: number, y: number): void {
    // The first mousemove only SEEDS the distance reference. lastMousePos starts
    // at (0,0), so without this the first move (from anywhere on screen) measures
    // a huge distance and spawns + collapses the host copy instantly — even a
    // tiny nudge. Seeding here means the first thumb needs a real reveal-step of
    // travel.
    if (!ctx.pointerSeeded) {
      ctx.pointerSeeded = true;
      ctx.lastMousePos = { x, y };
      return;
    }

    // Resuming movement on an ALREADY-active trail cancels any in-flight idle
    // clear (so a slow drag over what you just drew isn't yanked away) and keeps
    // it alive. Gated on heroHidden so a slow sub-threshold wander BEFORE the
    // first spawn leaves the host copy fully intact — nothing to cancel or reset
    // yet.
    if (ctx.heroHidden) {
      if (ctx.idleTimer) clearTimeout(ctx.idleTimer);
      ctx.isIdle = false;
      // Cancel any in-progress hide — new images will draw on top of
      // whatever is mid-fade (higher zIndexVal guarantees layering).
      if (ctx.isHidingImages) {
        ctx.hideGeneration++;
        ctx.isHidingImages = false;
      }
    }

    const distance = Math.hypot(x - ctx.lastMousePos.x, y - ctx.lastMousePos.y);
    if (distance > TRAIL_DISTANCE) {
      // The FIRST image appearing is what collapses the host copy — NOT a bare
      // mousemove. So a cursor that never travels a full reveal-step leaves the
      // copy fully in place (the slow-wiggle "crooked half-collapsed text" bug),
      // and the collapse is always justified by a thumb actually showing.
      if (!ctx.heroHidden) dismissal.hideHeroContent();
      ctx.imageTrail?.showNextImage(ctx.mousePos);
      ctx.lastMousePos = { x, y };
    }

    // Schedule the idle clear only once the trail is live (heroHidden == a spawn
    // has happened). Before the first spawn there's nothing to clear, so a slow
    // wander never arms the collapse → idle → reveal cycle that caused the jank.
    if (ctx.heroHidden) {
      ctx.idleTimer = setTimeout(() => {
        ctx.isIdle = true;
        // A LONE image never auto-dismisses — a one-card trail reads as a
        // deliberate "showcase" frame, so it stays up until the toggle clears
        // it. Two or more still clear after the idle window. heroHidden ⟹
        // active.length ≥ 1, so === 1 is exactly the single-card case (0 would
        // correctly fall through to reveal).
        if (ctx.imageTrail?.active.length === 1) return;
        ctx.hideQuickly = false;
        dismissal.hideImagesSequentially();
      }, 600);
    }
  }

  return {
    mouseMove: handleMouseMove,
    touchStart: handleTouchStart,
    touchMove: handleTouchMove,
    touchEnd: handleTouchEnd,
  };
}
