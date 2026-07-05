// The weighty trail clear, shared by the idle clear and the toggle-off close.
// Owns the per-thumb dismissal (foldOut), the host copy hide/reveal (via the
// ctx.hooks pair), and the staggered cascade (dismissTrail) bounded by the
// on-screen `active` set. The owner composes this first; toggle.ts borrows
// foldOut and input.ts borrows hideHeroContent / hideImagesSequentially
// (passed in explicitly).
//
// Extracted from vshslv.com src/scripts/home/image-trail/dismissal.ts. Two
// deltas: the hero-copy typewriter calls (collapseHeroCopy / expandHeroCopy)
// became the host-agnostic ctx.hooks.onEngage/onDisengage, and the isOverlayUp
// reveal-suppression gate is gone (no overlays in the sandbox — reintroduce it
// in revealHero if the target site grows a modal that owns the screen).

import { gsap } from "gsap";
import { prefersReducedMotion } from "../shared/device-detection.ts";
import type { TrailCtx } from "./context.ts";
import {
  DISMISS_STYLE,
  FOLD_ANGLE,
  FOLD_BLUR_PX,
  FOLD_DROP,
  FOLD_DUR,
  FOLD_EASE,
  FOLD_SCALE,
  GRAVITY_EASE,
  HERO_REVEAL_DUR,
  POP_DROP,
  POP_DUR,
  POP_EASE,
  SCAN_DUR,
  SCAN_EASE,
  SCAN_PINCH,
  SCAN_SPREAD_MS,
} from "./config.ts";

export interface DismissalApi {
  /** Dismiss a single thumb (per DISMISS_STYLE), optionally delayed. */
  foldOut(el: Element, delay?: number): void;
  /** Hide the host copy (first spawn). */
  hideHeroContent(): void;
  /** Reveal the host copy. `0` = instant snap (reduced-motion). */
  expandHero(duration: number): void;
  /** Clear the on-screen trail thumb-by-thumb, then reveal the host copy. */
  hideImagesSequentially(): void;
}

// [FOLD-HIDE] The weighty dismissal, shared by the idle clear and the
// toggle-off close. `overwrite: "auto"` means a respawn or a fresh fold cleanly
// supersedes this PER-PROPERTY, so a thumb is never stranded mid-fold (the
// stuck-card bug). The two tweens touch disjoint props (rotationY/scale vs y),
// so they coexist and only kill the stale spawn tween's matching props.
// `delay` staggers the cascade.
export function foldOut(el: Element, delay = 0): void {
  if (DISMISS_STYLE === "snap") {
    // [DISMISS-STYLE: snap] Instant vanish — no easing, no collapse animation.
    // The thumb just blinks off the instant its (randomly scheduled, see
    // dismissTrail) turn comes up, so the trail clears as a chaotic digital
    // flicker rather than a fade or a smooth collapse. duration:0 + delay keeps
    // overwrite-safety on reused pool slots; scaleX/scaleY/rotationY reset so the
    // next spawn from this slot is clean.
    gsap.to(el, {
      opacity: 0,
      scaleX: 1,
      scaleY: 1,
      rotationY: 0,
      duration: 0,
      delay,
      overwrite: "auto",
    });
    return;
  }

  if (DISMISS_STYLE === "scan") {
    // [DISMISS-STYLE: scan] The fast, digital "cleared a detection" collapse:
    // the thumb snaps shut on a quick vertical scaleY → 0 (a CRT scanline
    // turning off) with a slight horizontal pinch, on a sharp power3.in. The
    // CHAOS — random per-thumb order/timing — comes from dismissTrail scattering
    // the `delay`s; this is just the per-thumb snap. Opacity snaps off at the end
    // (never a fade) and scaleX/scaleY reset so the reused pool slot is clean.
    gsap.to(el, {
      scaleY: 0,
      scaleX: SCAN_PINCH,
      duration: SCAN_DUR,
      ease: SCAN_EASE,
      delay,
      overwrite: "auto",
      onComplete: () => gsap.set(el, { opacity: 0, scaleX: 1, scaleY: 1 }),
      onInterrupt: () => gsap.set(el, { opacity: 0, scaleX: 1, scaleY: 1 }),
    });
    return;
  }

  if (DISMISS_STYLE === "pop") {
    // [DISMISS-STYLE: pop] The true mirror of the spawn pop-in (pool.ts): the
    // thumb shrinks back to nothing on a back.in anticipation (reverse of the
    // spawn's back.out overshoot) and sinks the 30px it rose on spawn. No 3D
    // fold, no blur. Opacity snaps off at the very end (the spawn snapped it
    // on at the start) so the leave is never a fade — it's the pop, reversed.
    // onInterrupt snaps it gone so a killed shrink never strands a half-sized
    // thumb (a respawn re-sets scale/opacity/y from scratch).
    gsap.to(el, {
      scale: 0,
      duration: POP_DUR,
      ease: POP_EASE,
      delay,
      overwrite: "auto",
      onComplete: () => gsap.set(el, { opacity: 0 }),
      onInterrupt: () => gsap.set(el, { scale: 0, opacity: 0 }),
    });
    gsap.to(el, {
      y: `+=${POP_DROP}`,
      duration: POP_DUR,
      ease: POP_EASE,
      delay,
      overwrite: "auto",
    });
    return;
  }

  if (DISMISS_STYLE === "blur") {
    // [DISMISS-STYLE: blur] Soft dissolve instead of the 3D fold — fade to
    // transparent while ramping a blur and shrinking, sharing the gravity
    // drop below. onInterrupt snaps it gone + un-blurred so a killed dissolve
    // never lingers half-faded (a respawn re-sets opacity:1/filter:blur(0)).
    gsap.to(el, {
      opacity: 0,
      filter: `blur(${FOLD_BLUR_PX}px)`,
      scale: FOLD_SCALE,
      duration: FOLD_DUR,
      ease: "power2.in",
      delay,
      overwrite: "auto",
      onInterrupt: () => gsap.set(el, { opacity: 0, filter: "blur(0px)" }),
    });
    gsap.to(el, {
      y: `+=${FOLD_DROP}`,
      duration: FOLD_DUR,
      ease: GRAVITY_EASE,
      delay,
      overwrite: "auto",
    });
    return;
  }

  gsap.to(el, {
    rotationY: FOLD_ANGLE,
    scale: FOLD_SCALE,
    duration: FOLD_DUR,
    ease: FOLD_EASE,
    delay,
    overwrite: "auto",
    // Safety net for the "stuck half-folded sliver" bug. A fold always
    // completes to 92° on its own (→ backface-hidden → gone), so a stranded
    // partial angle can only happen if this tween is KILLED mid-swing without
    // a follow-up that re-sets rotationY. onInterrupt fires ONLY on such a
    // kill/overwrite (never on normal completion, so the motion is untouched)
    // and snaps the thumb back to a clean flat 0 — a normal trail thumb the
    // next respawn/clear handles — instead of leaving it frozen edge-on. This
    // makes the partial-angle state unreachable regardless of the exact race.
    onInterrupt: () => gsap.set(el, { rotationY: 0 }),
  });
  gsap.to(el, {
    y: `+=${FOLD_DROP}`,
    duration: FOLD_DUR,
    ease: GRAVITY_EASE,
    delay,
    overwrite: "auto",
  });
}

export function setupDismissal(ctx: TrailCtx): DismissalApi {
  // The host copy hide/reveal — on vshslv.com these were the char-by-char
  // hero-copy typewriter (hero-copy.ts); here they're whatever the host page
  // wired into ctx.hooks. `instant` mirrors reduced-motion / snap paths.
  function collapseHero(): void {
    ctx.hooks.onEngage(prefersReducedMotion());
  }

  // Reverse of collapseHero. `duration: 0` snaps instantly (reduced-motion).
  function expandHero(duration: number): void {
    ctx.hooks.onDisengage(duration === 0);
  }

  function hideHeroContent(): void {
    // heroHidden flips synchronously: the gate inside processMovement is "have
    // we started the trail flow," not "is the host copy fully gone." Waiting
    // for a tween's onComplete would delay the first image by ~half a second
    // after the cursor entered — the first thumb gets to paint at the same
    // instant the copy starts leaving.
    ctx.heroHidden = true;
    collapseHero();
  }

  // Reveal the host copy after a clear. `duration: 0` snaps (reduced-motion /
  // instant paths).
  function revealHero(duration: number): void {
    expandHero(duration);
    ctx.heroHidden = false;
  }

  // Dismiss the on-screen trail in a CHAOTIC burst: each visible thumb gets a
  // RANDOM start delay in [0, SCAN_SPREAD_MS), so they blink out in a
  // scattered, digital flicker rather than a tidy oldest→newest cascade.
  // Bounded by what's visible (imageTrail.active), never the reuse pool. The
  // generation guard cancels a half-run dismissal on a movement-resume or
  // toggle; un-dismissed thumbs stay in `active` so the next clear sweeps
  // them. The host copy returns once the last (latest-scheduled) thumb has
  // gone.
  function dismissTrail(heroDuration: number): void {
    const inst = ctx.imageTrail;
    if (!inst) return;

    ctx.isHidingImages = true;
    const gen = ++ctx.hideGeneration;
    const toFold = [...inst.active];
    const count = toFold.length;

    // A scaled idle clear (HERO_REVEAL_DUR) uses the full chaos spread; a quick
    // clear (touch-end, heroDuration 0.3) compresses it so successive draws stay
    // snappy. Each thumb's delay is independent random → no ordering.
    const spread = heroDuration <= 0.3 ? SCAN_SPREAD_MS * 0.5 : SCAN_SPREAD_MS;
    const delays = toFold.map(() => Math.random() * spread);
    const maxDelay = delays.length ? Math.max(...delays) : 0;

    toFold.forEach((imgEl, i) => {
      setTimeout(() => {
        // Superseded by a newer clear or a movement resumption.
        if (ctx.isToggling || ctx.hideGeneration !== gen) return;
        foldOut(imgEl.DOM.el);
        const at = inst.active.indexOf(imgEl);
        if (at !== -1) inst.active.splice(at, 1);
      }, delays[i]);
    });
    if (count === 0) ctx.isHidingImages = false;

    // Host copy returns once the last-scheduled thumb has snapped off (maxDelay
    // + the per-thumb collapse). Same gen guard cancels it on resume.
    setTimeout(
      () => {
        if (ctx.isToggling || ctx.hideGeneration !== gen) return;
        ctx.isHidingImages = false;
        revealHero(heroDuration);
      },
      count > 0 ? maxDelay + SCAN_DUR * 1000 : 0
    );
  }

  function hideImagesSequentially(): void {
    if (ctx.isToggling) return;
    dismissTrail(ctx.hideQuickly ? 0.3 : HERO_REVEAL_DUR);
  }

  return { foldOut, hideHeroContent, expandHero, hideImagesSequentially };
}
