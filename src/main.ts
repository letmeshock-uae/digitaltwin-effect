import "./style.css";
import { TRAIL_ORIENTATIONS } from "./data.ts";
import { setupControlsPanel } from "./image-trail/controls-panel.ts";
import { setupImageTrail } from "./image-trail/index.ts";
import { setupAsciiVideo } from "./ascii/ascii-video.ts";
import { ENGAGE_S, INTRO_HOLD_S } from "./ascii/ascii-constants.ts";
import { pickBgVideoSrc } from "./ascii/bg-video.ts";
import { isSafari, isTouchDevice } from "./shared/device-detection.ts";
import { setupPageLoader, onLoaderFinished } from "./shared/page-loader.ts";

// First-paint loader — kick the bar sweep before anything else mounts; the
// ASCII develop is gated on its `loaderFinished` contract (ascii modules).
setupPageLoader();

// Live controls panel (grid-window config sliders).
if (location.search.indexOf("noui") === -1) setupControlsPanel();

// [EXPERIMENTS] Variants live on numeric paths — the same index.html serves
// them all (Vite's SPA fallback in dev, the vercel.json rewrite in prod):
//   /  (1) — the full lab: intro develop → clean video + the image trail.
//   /2 and any unlisted number — the ascii field HELD: the develop runs
//            black → glyphs and freezes there; the whole backdrop stays the
//            ramp-ascii render (the trail-hero engaged state). No trail.
//   /3     — SPLIT SCREEN: left half the clean video, right half the held
//            ascii field. Split in-renderer (one cover crop, one frame), so
//            the seam is frame-exact on both engines. No trail.
//   /4     — /2 with the Kling particle-dune clip (kling.mp4).
//   /5     — /3 (split) with the Kling clip.
// The Kling clip is DARK (measured: p10≈0.06, avg≈0.11, p90≈0.21 luma) — the
// backdrop's BLACK_POINT 0.16 would blank ~85% of every frame, so /4 + /5
// override the contrast curve with the proven dark-clip pair (the mask
// windows' WIN_* rationale, ascii-constants.ts).
interface ExperimentSpec {
  /** Swap the backdrop clip (data-src-mp4 override; both engines read it). */
  src?: string;
  /** Left fraction rendered as CLEAN video — the split-screen experiments. */
  splitFrac?: number;
  /** Contrast-curve overrides for dark clips (default BLACK/WHITE_POINT). */
  blackPoint?: number;
  whitePoint?: number;
}
const EXPERIMENTS: Record<number, ExperimentSpec> = {
  3: { splitFrac: 0.5 },
  4: { src: "/media/kling.mp4", blackPoint: 0.04, whitePoint: 0.7 },
  5: {
    src: "/media/kling.mp4",
    splitFrac: 0.5,
    blackPoint: 0.04,
    whitePoint: 0.7,
  },
};
const EXPERIMENT =
  Number((location.pathname.match(/^\/(\d+)\/?$/) ?? [])[1]) || 1;
const SPEC = EXPERIMENTS[EXPERIMENT] ?? {};

// The abort signal is the teardown handle — kept from the original's Astro
// soft-nav lifecycle. A single-page sandbox never aborts it, but wiring it
// keeps the module drop-in for a site that does.
const controller = new AbortController();

// [EXPERIMENTS] Clip swap FIRST — pickBgVideoSrc reads the element's data-*,
// and the WebGL path copies them onto its own hidden video at mount, so the
// override must land before setupAsciiVideo runs.
const hero = document.querySelector<HTMLVideoElement>(".hero-video");
if (hero && SPEC.src) hero.dataset.srcMp4 = SPEC.src;

// ASCII backdrop FIRST (it hides the raw video synchronously for the intro
// develop — no first-frame pop), then promote the visible video's src on
// non-WebKit only: on WebKit the visible .hero-video must stay src-less (a
// playing inline video rides a hardware overlay that would occlude the glyph
// canvas — the WebGL path samples its own hidden copy instead).
setupAsciiVideo(controller.signal, {
  splitFrac: SPEC.splitFrac ?? 0,
  blackPoint: SPEC.blackPoint,
  whitePoint: SPEC.whitePoint,
});
if (hero && !(isTouchDevice() || isSafari())) {
  const src = pickBgVideoSrc(hero);
  if (src) {
    hero.src = src;
    hero.muted = true;
    hero.play().catch(() => {});
  }
}

if (EXPERIMENT === 1) {
  // Trail length = pool size. The renderer cycles imgPosition through every
  // .content__img and recycles the OLDEST back to the cursor once it wraps, so
  // the on-screen "snake" retains exactly as many thumbs as there are pool
  // elements. Repeating the list lengthens that snake WITHOUT new source images
  // — the browser caches each file, so the duplicates cost DOM nodes + GSAP
  // targets, not bytes. POOL_REPEAT = 2 ≈ doubles the trail length.
  const POOL_REPEAT = 2;

  // [MASK] The cards are EMPTY geometry boxes — no <img>. Their pixels come
  // from the mask layer (image-trail/mask-layer.ts) painting the slice of
  // mask.mp4 under each box; the pool and dismissal both keep reading these
  // same boxes.
  const wrap = document.querySelector<HTMLElement>(".image-wrap")!;
  for (let r = 0; r < POOL_REPEAT; r++) {
    for (const orientation of TRAIL_ORIENTATIONS) {
      const box = document.createElement("div");
      box.className = `content__img content__img--${orientation}`;
      wrap.appendChild(box);
    }
  }

  // Host-page reaction hooks — no-ops here (the demo copy is gone; a target
  // site wires its own reaction). [CODE-WINDOWS] The `trail-hero` dispatch is
  // deliberately GONE: the backdrop must never crossfade to the full-screen
  // ascii field — the code lives ONLY in the trail's torn windows
  // (mask-layer.ts). The ascii modules still mount for the one-shot intro
  // develop (and the WebKit clean-video renderer); their trail-hero listeners
  // simply never fire.
  const hooks = {
    onEngage(_instant: boolean): void {},
    onDisengage(_instant: boolean): void {},
  };

  setupImageTrail(controller.signal, hooks);
} else {
  // [EXPERIMENTS] /2+ — HOLD the ascii field. Let the intro develop fade
  // the glyphs up from black (ENGAGE_S), then freeze it mid-hold by firing the
  // same `trail-hero` engage the trail would: both renderers kill the develop
  // and pin the field at full ascii (canvas opacity / uMix = 1) — the
  // resolve-to-video never starts. The cursor lens (magnetism) stays live.
  onLoaderFinished(() => {
    setTimeout(() => {
      if (controller.signal.aborted) return;
      window.dispatchEvent(
        new CustomEvent("trail-hero", {
          detail: { hidden: true, instant: true },
        })
      );
    }, (ENGAGE_S + INTRO_HOLD_S / 2) * 1000);
  }, controller.signal);
}
