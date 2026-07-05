// Hero ASCII backdrop — renders the hero video as a grid of monospace glyphs
// FILLED WITH THE LIVE VIDEO ITSELF (each glyph is a little window onto the
// frame), black between them. The contentarchitecture.dev look, tied to the clip.
//
// Copied from vshslv.com src/scripts/home/ascii-video.ts. One delta: import
// paths (the loader gate is BACK — the lab ported the pixel-bar loader, so
// the develop again waits on onLoaderFinished exactly like the original).
//
// It is a MODE, not the resting backdrop: at rest the real `.hero-video` plays
// normally and this canvas is transparent (opacity 0, rAF stopped — zero cost).
// It engages when the image trail engages and disengages when the trail clears,
// driven by the `trail-hero` event (dispatched by the host hooks in main.ts).
//
// Transition: the canvas opacity crossfades over the still-playing <video>.
// Because the glyphs are the same pixels, fading the (black-gapped) glyph layer
// IN over the continuous video reads as the video disintegrating into text; OUT
// reverses it.
//
// [MAGNETISM] The glyph field reacts to the cursor (which is also where the image
// trail spawns): within MAG_RADIUS the ASCII is warped by a gravitational LENS
// toward the cursor, so the backdrop bends around the trail head. The warp is
// applied to the SAMPLED source cell (which part of the frame each FIXED grid cell
// shows), NOT to the glyph's draw position — so the grid stays fully inked and the
// lens never evacuates a region into a dark void (a position-pull would: glyphs
// slide toward the cursor and leave a dark "sphere" behind).
// Disabled under reduced-motion. The cursor is tracked in DEVICE px off pointermove.

import { gsap } from "gsap";
import { isSafari, isTouchDevice, prefersReducedMotion } from "../shared/device-detection.ts";
import { onLoaderFinished } from "../shared/page-loader.ts";
import { setupAsciiVideoWebGL } from "./ascii-video-webgl.ts";
// Look constants are SHARED with the WebGL path so the two renderers can
// never drift (ascii-constants.ts — single source of truth).
import {
  RAMP,
  FONT_PX,
  FONT_STACK,
  BLACK_POINT,
  WHITE_POINT,
  GAMMA,
  TARGET_FPS,
  ENGAGE_S,
  DISENGAGE_S,
  INTRO_HOLD_S,
  MAG_RADIUS_PX,
  MAG_LENS,
} from "./ascii-constants.ts";

// [EXPERIMENTS] Mount options for the path-picked variants (main.ts router).
export interface AsciiVideoOpts {
  /** 0..1 — the LEFT fraction of the canvas that renders the CLEAN video
   *  instead of glyphs (the /3 split-screen experiment). The split happens
   *  IN-RENDERER — the same cover crop and the same frame feed both halves,
   *  so the seam is frame-exact. 0 / absent = off (the verbatim look). */
  splitFrac?: number;
  /** Contrast-curve overrides for DARK experiment clips (the WIN_* rationale,
   *  ascii-constants.ts: a clip whose luma mostly sits under BLACK_POINT
   *  would blank into a black box). Absent = the backdrop's own
   *  BLACK_POINT / WHITE_POINT (the verbatim look). */
  blackPoint?: number;
  whitePoint?: number;
}

export function setupAsciiVideo(
  signal: AbortSignal,
  opts: AsciiVideoOpts = {}
): void {
  // CHROMIUM/FIREFOX DESKTOP = this 2D-canvas crossfade MODE (canvas faded OVER the
  // still-visible <video>). ANY WEBKIT (Safari desktop + iOS/touch) routes to the
  // WebGL path instead — the axis is the ENGINE, not the input: WebKit promotes the
  // playing inline <video> to a hardware-overlay plane that composites ABOVE a
  // sibling <canvas> regardless of z-index OR DOM order (WebKit bug 29314), so the
  // over-the-video crossfade is INVISIBLE there — the opaque ASCII canvas is drawn
  // (readback confirms pixels) but never presented. First proven on iOS; confirmed
  // the SAME on macOS desktop Safari (z:2147483647 + translateZ(0) still lost to the
  // video overlay). ascii-video-webgl.ts sidesteps it entirely: the canvas is the
  // ONLY visible layer and samples a HIDDEN (opacity:0) video as a GPU texture — no
  // visible <video>, so nothing to overlay. Same look, same trail-hero engage/
  // disengage; the lens follows the finger (touch) or the cursor (desktop Safari).
  // The 2D path below stays Chromium/Firefox-only.
  if (isTouchDevice() || isSafari()) {
    setupAsciiVideoWebGL(signal, opts);
    return;
  }

  const splitFrac = Math.min(Math.max(opts.splitFrac ?? 0, 0), 1);
  const blackPoint = opts.blackPoint ?? BLACK_POINT;
  const whitePoint = opts.whitePoint ?? WHITE_POINT;

  const video = document.querySelector<HTMLVideoElement>(".hero-video");
  if (!video) return;

  // [INTRO] Hold the raw video hidden until the develop reveals it out of the ASCII
  // glyph field (runIntroReveal, below). Set synchronously — same mount tick as the
  // src promote in main.ts, before the clip can paint a frame — so there's no pop.
  // CSS opacity:0 does NOT stop the video decoding or being drawImage-sampled into
  // the glyph canvas (same trick the WebGL touch path uses), so the ASCII source is
  // unaffected.
  gsap.set(video, { opacity: 0 });

  const canvas = document.createElement("canvas");
  canvas.className = "hero-ascii";
  canvas.setAttribute("aria-hidden", "true");
  const mctx = canvas.getContext("2d"); // alpha — black is painted per frame, gaps stay transparent under it
  if (!mctx) return;
  video.insertAdjacentElement("afterend", canvas);

  // Tiny offscreen — downsamples the frame to one pixel per cell for the ramp.
  const sample = document.createElement("canvas");
  const sctx = sample.getContext("2d", { willReadFrequently: true });
  if (!sctx) {
    canvas.remove();
    return;
  }

  // Geometry (DEVICE pixels — crisp on HiDPI without ctx scaling), rebuilt on resize.
  let dpr = 1;
  let cellW = 0;
  let cellH = 0;
  let cols = 0;
  let rows = 0;
  let atlas: HTMLCanvasElement | null = null;

  // [MAGNETISM] Cursor in DEVICE px (-1 = not seen yet → no pull). Tracked off
  // pointermove; the per-cell pull in draw() reads it. Off under reduced-motion.
  let curX = -1;
  let curY = -1;
  const magnetism = !prefersReducedMotion();

  function buildAtlas(): void {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cellH = Math.max(1, Math.round(FONT_PX * dpr));
    mctx!.font = `${FONT_PX * dpr}px ${FONT_STACK}`;
    cellW = Math.max(1, Math.round(mctx!.measureText("M").width));

    const a = atlas ?? document.createElement("canvas");
    a.width = cellW * RAMP.length;
    a.height = cellH;
    const actx = a.getContext("2d")!;
    actx.clearRect(0, 0, a.width, a.height);
    actx.font = `${FONT_PX * dpr}px ${FONT_STACK}`;
    actx.textAlign = "center";
    actx.textBaseline = "middle";
    actx.fillStyle = "#fff"; // opaque white = the alpha mask the video is poured into
    for (let i = 1; i < RAMP.length; i++) {
      actx.fillText(RAMP[i], i * cellW + cellW / 2, cellH / 2);
    }
    atlas = a;
  }

  function resize(): void {
    buildAtlas();
    canvas.width = Math.max(1, Math.round(window.innerWidth * dpr));
    canvas.height = Math.max(1, Math.round(window.innerHeight * dpr));
    cols = Math.ceil(canvas.width / cellW);
    rows = Math.ceil(canvas.height / cellH);
    sample.width = cols;
    sample.height = rows;
  }

  function draw(): void {
    if (!atlas || video!.videoWidth === 0 || video!.readyState < 2) return;

    // object-fit: cover crop — same framing as the resting video.
    const vw = video!.videoWidth;
    const vh = video!.videoHeight;
    const scale = Math.max(canvas.width / vw, canvas.height / vh);
    const sw = canvas.width / scale;
    const sh = canvas.height / scale;
    const sx = (vw - sw) / 2;
    const sy = (vh - sh) / 2;
    sctx!.drawImage(video!, sx, sy, sw, sh, 0, 0, cols, rows);

    let data: Uint8ClampedArray;
    try {
      data = sctx!.getImageData(0, 0, cols, rows).data;
    } catch {
      return;
    }

    // 1) Paint the glyph coverage as an opaque-white alpha mask.
    mctx!.globalCompositeOperation = "source-over";
    mctx!.clearRect(0, 0, canvas.width, canvas.height);
    const last = RAMP.length - 1;
    // [MAGNETISM] Precompute the cursor lens once per frame. The warp re-maps
    // which SOURCE cell each fixed grid cell samples (below), so the grid stays
    // fully inked — no glyph is moved, so no region is left dark.
    const magOn = magnetism && curX >= 0;
    const radius = MAG_RADIUS_PX * dpr;
    const radius2 = radius * radius;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // [MAGNETISM] Default = sample this cell straight; within the lens radius
        // sample FARTHER from the cursor (k>1, eased) so the surrounding scene is
        // drawn inward — the ASCII pinches toward the cursor like gravity. The
        // glyph still paints at its OWN fixed cell, so coverage never thins out.
        let sc = c;
        let sr = r;
        if (magOn) {
          const vx = c * cellW + cellW * 0.5 - curX;
          const vy = r * cellH + cellH * 0.5 - curY;
          const d2 = vx * vx + vy * vy;
          if (d2 < radius2) {
            const f = 1 - Math.sqrt(d2) / radius;
            const k = 1 + f * f * MAG_LENS;
            sc = ((curX + vx * k) / cellW) | 0;
            sr = ((curY + vy * k) / cellH) | 0;
            if (sc < 0) sc = 0;
            else if (sc >= cols) sc = cols - 1;
            if (sr < 0) sr = 0;
            else if (sr >= rows) sr = rows - 1;
          }
        }
        const p = (sr * cols + sc) * 4;
        const lum = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) / 255;
        let b = (lum - blackPoint) / (whitePoint - blackPoint);
        if (b <= 0) continue; // blank cell — no ink here
        if (b > 1) b = 1;
        const idx = Math.round(Math.pow(b, GAMMA) * last);
        if (idx <= 0) continue;
        mctx!.drawImage(atlas, idx * cellW, 0, cellW, cellH, c * cellW, r * cellH, cellW, cellH);
      }
    }

    // 2) Pour the live frame INTO the glyph shapes (only where the mask is opaque).
    mctx!.globalCompositeOperation = "source-in";
    mctx!.drawImage(video!, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    // 3) Fill the gaps BEHIND the glyph-video with black.
    mctx!.globalCompositeOperation = "destination-over";
    mctx!.fillStyle = "#000";
    mctx!.fillRect(0, 0, canvas.width, canvas.height);
    mctx!.globalCompositeOperation = "source-over";

    // 4) [EXPERIMENTS] Split view (splitFrac > 0): paint the CLEAN frame over
    //    the left fraction of the canvas — the same cover crop and the same
    //    frame as the glyph fill above, so the natural↔ascii seam is exact.
    if (splitFrac > 0) {
      mctx!.drawImage(
        video!,
        sx, sy, sw * splitFrac, sh,
        0, 0, canvas.width * splitFrac, canvas.height
      );
    }
  }

  // ---- engage / disengage --------------------------------------------------
  let running = false;
  let rafId = 0;
  let lastT = 0;
  let hasFrame = false;
  const frameMs = 1000 / TARGET_FPS;

  // [INTRO] First-load "develop" state (see runIntroReveal, below).
  let introTl: ReturnType<typeof gsap.timeline> | null = null;
  let introDone = false;

  function loop(t: number): void {
    if (!running) return;
    rafId = requestAnimationFrame(loop);
    if (document.hidden) return;
    // Hold the last frame while the video is paused, but always paint once when
    // the first frame is available.
    if (video!.paused && hasFrame) return;
    if (t - lastT < frameMs) return;
    lastT = t;
    draw();
    hasFrame = true;
  }

  function startLoop(): void {
    if (running) return;
    running = true;
    lastT = 0;
    rafId = requestAnimationFrame(loop);
  }
  function stopLoop(): void {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function engage(instant: boolean): void {
    if (cols === 0) resize();
    startLoop();
    gsap.killTweensOf(canvas);
    if (instant) {
      draw();
      hasFrame = true;
      gsap.set(canvas, { opacity: 1 });
    } else {
      gsap.to(canvas, { opacity: 1, duration: ENGAGE_S, ease: "power2.in" });
    }
  }

  function disengage(instant: boolean): void {
    gsap.killTweensOf(canvas);
    if (instant) {
      gsap.set(canvas, { opacity: 0 });
      stopLoop();
    } else {
      gsap.to(canvas, {
        opacity: 0,
        duration: DISENGAGE_S,
        ease: "power2.out",
        onComplete: stopLoop,
      });
    }
  }

  // ---- intro reveal --------------------------------------------------------
  // First-load "develop": the raw video must NOT pop. The backdrop starts BLACK,
  // the ASCII glyph field fades IN over it (the existing engage crossfade), holds a
  // beat, then the video RESOLVES OUT of the glyphs (the existing disengage
  // crossfade). The video itself never fades — it's snapped visible BEHIND the
  // opaque glyph cover, so only the ASCII layer crossfades. Reuses ENGAGE_S /
  // DISENGAGE_S / INTRO_HOLD_S (shared ascii-constants.ts). The WebGL touch path
  // mirrors this in-shader (ascii-video-webgl.ts) — same look, different mechanism
  // (a uReveal uniform, no video layer).
  function finishIntro(): void {
    introDone = true;
    introTl = null;
  }
  function runIntroReveal(): void {
    if (prefersReducedMotion()) {
      // No develop under reduced-motion — just show the video.
      gsap.set(video!, { opacity: 1 });
      finishIntro();
      return;
    }
    const develop = (): void => {
      if (signal.aborted || introDone) return;
      if (cols === 0) resize();
      startLoop();
      draw();
      hasFrame = true;
      gsap.set(canvas, { opacity: 0 });
      introTl = gsap.timeline({
        onComplete: () => {
          stopLoop();
          finishIntro();
        },
      });
      // black → glyphs fade in (the video is still hidden behind)
      introTl.to(canvas, { opacity: 1, duration: ENGAGE_S, ease: "power2.in" });
      // snap the video visible BEHIND the now-opaque glyph cover (no video fade)
      introTl.add(() => {
        if (!signal.aborted) gsap.set(video!, { opacity: 1 });
      });
      // hold on the glyphs, then resolve them away → the video is revealed
      introTl.to(
        canvas,
        { opacity: 0, duration: DISENGAGE_S, ease: "power2.out" },
        `+=${INTRO_HOLD_S}`
      );
    };
    if (video!.readyState >= 2) develop();
    else {
      video!.addEventListener("loadeddata", develop, { once: true, signal });
      // Safety: never leave the hero black if the clip never fires loadeddata.
      setTimeout(() => {
        if (introDone || signal.aborted) return;
        gsap.set(video!, { opacity: 1 });
        finishIntro();
      }, 4000);
    }
  }

  function onTrailHero(e: Event): void {
    const detail = (e as CustomEvent<{ hidden: boolean; instant: boolean }>).detail;
    if (!detail) return;
    // If the trail engages/disengages mid-intro, abandon the develop and make sure
    // the video is visible (engage re-covers it with ASCII; disengage reveals it).
    if (!introDone) {
      introTl?.kill();
      introTl = null;
      introDone = true;
      gsap.set(video!, { opacity: 1 });
    }
    if (detail.hidden) engage(detail.instant);
    else disengage(detail.instant);
  }

  // Debounced through rAF so a drag-resize doesn't rebuild the atlas per event.
  let resizeRaf = 0;
  function onResize(): void {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      resize();
      if (running) draw();
    });
  }

  // [MAGNETISM] Track the cursor in device px for the per-cell pull. Registered
  // only when the effect is on (reduced-motion skips it entirely).
  function onPointerMove(e: PointerEvent): void {
    curX = e.clientX * dpr;
    curY = e.clientY * dpr;
  }

  resize();
  window.addEventListener("trail-hero", onTrailHero, { signal });
  window.addEventListener("resize", onResize, { signal });
  if (magnetism)
    window.addEventListener("pointermove", onPointerMove, { signal });
  // [INTRO] Kick the first-load develop (black → glyphs → video) only AFTER the
  // loader bar completes (loaderFinished) — otherwise the glyphs would develop
  // UNDER the black loader cover and be wasted. The video decodes in parallel
  // during the bar; develop() waits for its first frame either way.
  onLoaderFinished(runIntroReveal, signal);
  signal.addEventListener("abort", () => {
    introTl?.kill();
    stopLoop();
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    gsap.killTweensOf(canvas);
    gsap.set(video!, { opacity: 1 });
    canvas.remove();
  });
}
