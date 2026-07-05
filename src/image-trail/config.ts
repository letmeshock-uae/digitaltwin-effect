// Tuning constants for the image-trail cursor effect. The "feel knobs" —
// spawn pop + breathing, the weighty fold/blur dismissal, the per-thumb clear
// cascade, and the reveal-distance thresholds — live here so a tuning pass
// touches one file; the behaviour that reads them is split across pool.ts
// (spawn), dismissal.ts (the clear), input.ts (reveal density), and toggle.ts
// (the on/off flip). Every value's rationale is in the comments — keep them
// with the constant they explain. Also holds the two pure leaf helpers
// (dismissDelay, isMobileViewport) the subsystems share.
//
// Extracted from vshslv.com src/scripts/home/image-trail/config.ts. The one
// removal: isOverlayUp() (that site's modal/terminal overlay gate) — this
// sandbox has no overlays. If the target site grows one, reintroduce the gate
// in input.ts (spawn suppression) + dismissal.ts (reveal suppression).

export interface Point {
  x: number;
  y: number;
}

// [FOLD-HIDE] A clearing trail image doesn't just fade — it folds away around
// its own vertical centre axis (rotationY) under a per-element self-perspective,
// reading as a card turning edge-on: the pseudo-3D "horizontal roll-up" the
// trail uses to dismiss thumbnails. We use transformPerspective (perspective
// baked into the thumb's OWN transform) rather than a `perspective` on the
// wrapper, so every thumb folds around its own centre vanishing point — a
// shared wrapper point of view would shear the folds of thumbnails far from the
// wrapper centre. Perspective is invisible while rotationY is 0, so it's set
// once per spawn (in showNextImage) and harmless on un-folded thumbs.
// Because the image pool is reused cyclically, that same spawn-set MUST reset
// rotationY to 0 — otherwise a thumb reborn from a prior fold spawns edge-on.
export const FOLD_PERSPECTIVE = 800;
// A hair past edge-on: at >90° the front face turns away and
// `backface-visibility: hidden` (style.css) hides the mirrored back, so
// the thumb is simply gone. There's no opacity fade — the fold collapsing past
// edge-on IS the whole dismissal, so this angle must clear 90°.
export const FOLD_ANGLE = 92;

// [SPAWN] Motion character — "programmer" feel: NO easing, NO entrance motion.
// SPAWN_INSTANT makes a thumb just BE THERE the instant it's detected — full
// opacity, full (breathing) size, in place — like a piece of software drawing a
// detection box. No fade, no scale-up, no rise, no curve: all "smoothness" is
// removed. The rhythm/chaos comes purely from the random dismissal + the tear
// gaps below, not from any tween. (Set false to fall back to the eased entrance:
// SPAWN_EASE/DUR/POP/RISE drive a fade + light scale-up — kept for A/B only.)
export const SPAWN_INSTANT = true;
export const SPAWN_EASE = "power2.out";
export const SPAWN_DUR = 0.4;
export const SPAWN_POP = 0.9;
export const SPAWN_RISE = 14;
// Kept for the retired "fold" dismissal style only (see DISMISS_STYLE).
export const FOLD_EASE = "back.in(1.3)";
export const FOLD_DUR = 0.45;
// Thumb shrinks as it collapses — receding mass. The rotationY fold kills its
// width; this halves the height too, so it implodes toward a small point/line
// rather than just flattening in place. Absolute target, so every thumb
// converges on the same small size as it vanishes regardless of its breathing
// scale (bigger thumbs simply deflate harder — reads as weight).
export const FOLD_SCALE = 0.5;
// Gravity — a collapsing thumb also drops, accelerating downward on a power-in
// curve (a real fall, on its own tween so it's independent of the fold's
// back.in wind-up). Relative (+=) so it stacks from wherever the thumb sits; a
// respawn resets y absolutely, so the drop never accumulates on-screen.
export const FOLD_DROP = 60;
export const GRAVITY_EASE = "power2.in";

// A clear dismisses the on-screen trail ONE THUMB AT A TIME (oldest → newest)
// — only the thumbs actually shown (tracked in ImageTrailInstance.active), NOT
// the whole reuse pool. So the cascade length scales with what you SEE, never
// with the pool size. DISMISS_STEP_MS is the gap between thumbs; DISMISS_MAX_MS
// caps the whole run so a dense full-screen trail still clears fast (the step
// shrinks to fit). The host copy then returns as the last thumb folds.
const DISMISS_STEP_MS = 30;
const DISMISS_MAX_MS = 600;
export const HERO_REVEAL_DUR = 0.4;

// Per-thumb dismissal delay (ms): a flat DISMISS_STEP_MS gap, compressed if the
// run of `count` thumbs would otherwise exceed DISMISS_MAX_MS.
export function dismissDelay(index: number, count: number): number {
  if (count <= 1) return 0;
  const step = Math.min(DISMISS_STEP_MS, DISMISS_MAX_MS / (count - 1));
  return index * step;
}

// [DISMISS-STYLE] How a thumb leaves on a clear:
//   • "snap" — the DEFAULT, "programmer" feel: the thumb just BLINKS OFF
//     instantly (opacity → 0, no easing, no collapse animation) the moment its
//     RANDOMLY-scheduled turn comes up in dismissTrail. The trail clears as a
//     chaotic digital flicker — like software dropping its detections — with
//     zero smoothness. The chaos is all in the random per-thumb timing, not in
//     any per-thumb curve.
//   • "scan" — a fast vertical scaleY → 0 collapse (a CRT scanline) on a sharp
//     ease, also randomly scattered. Has a hair of motion; kept as an alternate.
//   • "pop"  — the mirror of the spawn pop-in: shrinks back to 0 on a back.in.
//   • "fold" — rotates edge-on (a 3D card roll-up).
//   • "blur" — dissolves (opacity → 0 while ramping a blur + shrinking).
// Flip this single constant to compare the feels. showNextImage / toggle-on
// reset `filter`/`rotationY`/`scale` so a reused pool thumb never respawns
// blurry, edge-on, or shrunk.
export const DISMISS_STYLE = "snap" as "snap" | "scan" | "fold" | "blur" | "pop";
export const FOLD_BLUR_PX = 48;

// [DISMISS-STYLE: snap/scan] The CHAOS — random per-thumb start times — is shared
// by both digital styles. SCAN_SPREAD_MS is how wide the RANDOM per-thumb delays
// are scattered (dismissTrail rolls each thumb's delay in [0, SPREAD)), so the
// trail blinks out in a scattered burst, not a tidy cascade. Widened 260 → 550
// so the clear reads as a deliberate row-by-row "software dropping detections"
// sweep rather than an instant all-at-once flush (each thumb still snaps off
// instantly — only the burst is spread over a longer window). SCAN_DUR/EASE/PINCH
// only shape the "scan" collapse (unused by the instant "snap"); SCAN_DUR also
// pads the post-clear beat before the host copy returns.
export const SCAN_DUR = 0.1;
export const SCAN_SPREAD_MS = 550;
export const SCAN_EASE = "power3.in";
export const SCAN_PINCH = 0.7;

// [DISMISS-STYLE: pop] The mirror of the spawn — kept as an alternate. back.in
// is the reverse of a back.out spawn (winds up, then collapses to 0); POP_DROP
// mirrors the rise. (The live spawn is now eased-linear, so "pop" no longer
// matches it 1:1 — it's a legacy feel, not the default.)
export const POP_EASE = "back.in(1.5)";
export const POP_DUR = 0.4;
export const POP_DROP = 30;

// [TEAR] The trail occasionally "rips": a short run of spawns is SKIPPED, so the
// stroke shows gaps/breaks (a glitchy, dropped-signal feel). Per eligible spawn
// (never the first — the trail must establish first) there's a TEAR_CHANCE of
// starting a gap run of TEAR_RUN_MIN..TEAR_RUN_MAX skipped thumbs. The cursor
// still advances, so the next thumb lands a gap further along.
export const TEAR_CHANCE = 0.1;
export const TEAR_RUN_MIN = 1;
export const TEAR_RUN_MAX = 3;

// [SIZE] Per-spawn size follows a DISCRETE modular scale, not a random wave —
// the "logic" the sizes have. Each value is a multiplier on the CSS
// --trail-unit (style.css, stepped per breakpoint), and the three tiers are
// a 1.25 modular scale: L = 1.0 (= exactly the unit, the cap), M = 0.8, S = 0.64.
// TRAIL_SIZE_TIERS is the per-spawn CYCLE (indexed by the spawn counter): the
// LARGEST tier appears once per cycle and the rest skew small, so big thumbs are
// the rare exception, not the norm — and since the top tier is 1.0, NOTHING ever
// exceeds the unit. Swap in your own pattern of {1.0, 0.8, 0.64} to retune the
// rhythm/mix.
export const TRAIL_SIZE_TIERS = [1.0, 0.64, 0.8, 0.64, 0.8, 0.64];

// Distance (px) the cursor must travel between successive trail image
// reveals on desktop. Tuned against ~24/21rem thumbs on vshslv.com — smaller
// images at a wider spacing read as a sparse trail, so a tighter threshold
// packs more thumbs in and keeps the trail dense during movement. Each reveal
// also fires the hover SFX, which the Web Audio engine (shared/sfx.ts)
// handles cleanly at this rate.
export const TRAIL_DISTANCE = 90;
// Distance (px) the finger must travel between successive trail
// image reveals on touch. Lower than the desktop TRAIL_DISTANCE
// because phone viewports are small — at the desktop value a swipe across
// the screen would only fire a couple of images. 80 lets a figure-8 of
// strokes paint a recognizable trail.
export const TRAIL_DISTANCE_TOUCH = 80;

// Matches the ≤479px breakpoint. Kept for host-site integrations that need to
// branch on the phone viewport (vshslv.com used it to route its bg-video
// promote); the sandbox core doesn't read it.
export function isMobileViewport(): boolean {
  return window.matchMedia("(max-width: 479px)").matches;
}
