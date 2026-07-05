// Shared mutable state for the image-trail cursor effect.
//
// The trail is one small state machine: the input handlers, the dismissal
// cascade, and the on/off toggle all read and write the same handful of flags
// (heroHidden, isHidingImages, hideGeneration, isToggling, …). So rather than
// thread them through call sites, the owner (index.ts) builds ONE `TrailCtx`
// object that every subsystem reads and writes BY REFERENCE — a flag bumped by
// the toggle (`hideGeneration`) is the same one the dismissal cascade's
// deferred callbacks check.
//
// Wiring is acyclic: the owner builds this ctx, then composes the subsystems —
//   setupDismissal(ctx)        → { foldOut, hideHeroContent, hideImagesSequentially }
//   setupToggle(ctx, dismissal)→ { handleToggle }   (needs dismissal.foldOut)
//   setupInput(ctx, dismissal) → mouse + touch handlers (need hideHeroContent /
//                                hideImagesSequentially)
// — passing each subsystem its cross-subsystem dependencies EXPLICITLY (as args,
// not via ctx) so the dependency graph stays visible. The owner also owns the
// instance creation, the deferred event binding (after images load), and teardown.
//
// Extracted from vshslv.com src/scripts/home/image-trail/context.ts. The DOM
// refs its hero owned (heroContent / the .scrim curtain / the toggle knob) are
// replaced by the `hooks` pair — the host page decides how to react.

import type { Point } from "./config.ts";
import type { ImageTrailInstance } from "./pool.ts";

// How the HOST page reacts to the trail taking / releasing the screen. On
// vshslv.com these were the hero copy's char-by-char type-out/in; wire them to
// whatever the target site needs. `instant` mirrors reduced-motion (snap, no
// animation).
export interface TrailHooks {
  /** The trail's first thumb just spawned — hide the page's copy. */
  onEngage(instant: boolean): void;
  /** The trail cleared — bring the page's copy back. */
  onDisengage(instant: boolean): void;
}

export interface TrailCtx {
  // --- pool (created once the trail's images have loaded) ----------------
  /** The thumbnail reuse pool + on-screen active tracking; null until loaded. */
  imageTrail: ImageTrailInstance | null;

  // --- host hooks + signal ------------------------------------------------
  hooks: TrailHooks;
  signal: AbortSignal;

  // --- pointer position --------------------------------------------------
  mousePos: Point;
  lastMousePos: Point;
  /** False until the first mousemove seeds lastMousePos. lastMousePos starts at
      (0,0), so the first move would otherwise measure a huge distance and spawn
      (and collapse the host copy) instantly; seeding on the first move means the
      first thumb needs a real reveal-step of travel. Desktop mouse only — touch
      seeds lastMousePos on touchstart. */
  pointerSeeded: boolean;

  // --- idle / hide state (mutated across input + dismissal + toggle) -----
  isIdle: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** Bumped to no-op any in-flight deferred fold callbacks (resume / toggle / clear). */
  hideGeneration: number;
  heroHidden: boolean;
  hideQuickly: boolean;
  isHidingImages: boolean;

  // --- toggle state -------------------------------------------------------
  animationPaused: boolean;
  isToggling: boolean;
  toggleResetTimer: ReturnType<typeof setTimeout> | null;
}
