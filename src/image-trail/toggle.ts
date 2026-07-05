// The trail on/off toggle: folds the on-screen trail away (OFF) or snaps the
// pool clean (ON), and hands the host copy back via dismissal.expandHero.
// Drives the `trail-off` body class + the `trail-toggled` event so host chrome
// can react. Borrows dismissal.foldOut for the per-thumb off cascade.
//
// SIMPLIFIED from vshslv.com src/scripts/home/image-trail/toggle.ts — the
// state machine (generation bump, isToggling latch, deferred reveal, the
// clean-slate pool snap) is kept intact; what's dropped is that site's
// chrome: the hero bg-video promote/pause (curtain-blur reveal), the on-screen
// toggle-knob animation, and the `magic-off`/`magic-toggled` names. If the
// target site needs a visual mode flip on toggle (backdrop swap etc.), hang it
// off the `trail-toggled` event.

import { gsap } from "gsap";
import { prefersReducedMotion } from "../shared/device-detection.ts";
import type { TrailCtx } from "./context.ts";
import type { DismissalApi } from "./dismissal.ts";
import { dismissDelay, FOLD_DUR } from "./config.ts";

export interface ToggleApi {
  handleToggle(): void;
}

export function setupToggle(ctx: TrailCtx, dismissal: DismissalApi): ToggleApi {
  // The deferred host-copy reveal: on toggle-off we wait for the trail to fully
  // fold away THEN reveal (so it doesn't overlap the dismissing thumbs — that
  // overlap reads as a stutter). Held here so a follow-up toggle (or teardown)
  // can cancel a pending reveal.
  let revealCall: ReturnType<typeof gsap.delayedCall> | null = null;
  ctx.signal.addEventListener("abort", () => {
    revealCall?.kill();
    revealCall = null;
  });

  function handleToggle(): void {
    // No click drop here — every click flips the state immediately. The
    // killTweensOf calls below clear any in-flight toggle animation so
    // rapid clicks don't pile up. `isToggling` still latches for ~400ms
    // to keep the mouse / touch handlers (which can race with the trail
    // tweens) out of the way during the transition.
    if (ctx.toggleResetTimer) clearTimeout(ctx.toggleResetTimer);
    // Cancel any pending toggle-off reveal so a fresh toggle owns the state.
    revealCall?.kill();
    revealCall = null;
    ctx.isToggling = true;

    // Invalidate any in-flight idle clear. Its folds are scheduled via
    // setTimeout over ~½s, but `isToggling` only latches ~400ms — so without
    // this bump, stale folds from a pre-toggle clear keep firing on thumbs the
    // toggle has since respawned / hidden, leaving some stranded mid-fold (the
    // stuck-card bug). Bumping the generation makes every pending callback
    // no-op for BOTH toggle directions.
    ctx.hideGeneration++;
    ctx.isHidingImages = false;

    ctx.animationPaused = !ctx.animationPaused;

    // Reduced-motion: snap straight to each tween's END STATE instead of
    // animating. The state still flips below (body.trail-off + the
    // `trail-toggled` event fire regardless); only the motion is dropped.
    const reduced = prefersReducedMotion();

    // Body class is the single source of truth for host CSS; the event lets
    // host JS react (swap a backdrop, re-enable hover chrome, …).
    document.body.classList.toggle("trail-off", ctx.animationPaused);
    window.dispatchEvent(
      new CustomEvent("trail-toggled", {
        detail: { trailOff: ctx.animationPaused },
      })
    );

    if (ctx.animationPaused) {
      // Trail OFF: stop the trail and restore the host copy fully.
      gsap.killTweensOf(".content__img");

      // Dismiss the on-screen trail one thumb at a time — the same per-thumb
      // cascade as the idle clear (dismissDelay), over only the visible thumbs
      // (imageTrail.active), not the whole reuse pool. Reduced-motion snaps the
      // entire pool to rest in one shot.
      const active = ctx.imageTrail ? [...ctx.imageTrail.active] : [];
      if (reduced) {
        gsap.set(".content__img", {
          opacity: 0,
          rotationY: 0,
          scale: 0.8,
          filter: "blur(0px)",
        });
      } else {
        active.forEach((imgEl, i) => {
          dismissal.foldOut(imgEl.DOM.el, dismissDelay(i, active.length) / 1000);
        });
      }
      if (ctx.imageTrail) ctx.imageTrail.active.length = 0;

      // Cancel any pending idle-clear timer (the ON branch does the same),
      // so it can't fire a stray dismiss/reveal after the toggle owns the state.
      if (ctx.idleTimer) {
        clearTimeout(ctx.idleTimer);
        ctx.idleTimer = null;
      }

      // Reveal the host copy. Reduced-motion → instant snap. Otherwise WAIT for
      // the trail to fully fold away first, THEN reveal — if it ran immediately
      // it would overlap the still-dismissing thumbs, which reads as a stutter.
      // The wait = the last thumb's stagger delay + its fold duration.
      if (reduced) {
        dismissal.expandHero(0);
      } else {
        const foldEndMs =
          (active.length ? dismissDelay(active.length - 1, active.length) : 0) +
          FOLD_DUR * 1000;
        revealCall = gsap.delayedCall(foldEndMs / 1000, () => {
          revealCall = null;
          if (ctx.animationPaused) dismissal.expandHero(0.4); // still off → reveal
        });
      }

      ctx.heroHidden = false;
    } else {
      // Trail ON: kill any in-flight fold cascade (a half-done toggle-off
      // close, or started idle folds) and snap every thumb hidden, so the
      // resumed trail starts from a clean slate — nothing left mid-fold,
      // nothing lingering visible at a stale position. A respawn restores
      // opacity + resets the transform, so opacity:0 is enough to park them.
      gsap.killTweensOf(".content__img");
      // Terminal reset, not just opacity: also un-fold (rotationY:0) and reset
      // scale, mirroring the reduced-motion off end-state. Killing a fold
      // mid-swing would otherwise freeze its partial rotationY behind opacity:0
      // — a latent stranded angle that leaks if opacity is ever raised without
      // a fresh spawn-set. Snapping all three keeps the pool definitively clean.
      gsap.set(".content__img", {
        opacity: 0,
        rotationY: 0,
        scale: 0.8,
        filter: "blur(0px)",
      });
      if (ctx.imageTrail) ctx.imageTrail.active.length = 0;

      ctx.lastMousePos = { ...ctx.mousePos };
      ctx.isHidingImages = false;
      ctx.hideQuickly = false;
      ctx.heroHidden = false;
      // Snap the host copy to its rest (visible) state — trail mode shows it at
      // rest, and this restores it instantly if a rapid OFF→ON cancelled the
      // toggle-off deferred reveal while the copy was still hidden.
      dismissal.expandHero(0);

      if (ctx.idleTimer) {
        clearTimeout(ctx.idleTimer);
        ctx.idleTimer = null;
      }
    }

    // 400ms covers the toggle transition. Track the timer so a follow-up click
    // can reset the latch instead of letting a stale one fire while a fresh
    // transition is in flight.
    ctx.toggleResetTimer = setTimeout(() => {
      ctx.isToggling = false;
      ctx.toggleResetTimer = null;
    }, 400);
  }

  return { handleToggle };
}
