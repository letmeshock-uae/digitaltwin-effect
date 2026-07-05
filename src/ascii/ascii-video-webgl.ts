// Hero ASCII backdrop — the WEBKIT path (WebGL2): iOS/touch AND desktop Safari.
//
// Copied from vshslv.com src/scripts/home/ascii-video-webgl.ts. One delta:
// import paths (the loader gate is BACK — the lab ported the pixel-bar
// loader, so the develop again waits on onLoaderFinished like the original).
//
// WHY THIS EXISTS (the 2D crossfade path can't run on WebKit): WebKit promotes a
// playing inline <video> to a hardware-overlay plane that composites ABOVE a 2D/
// WebGL canvas sibling regardless of z-index OR DOM order (WebKit bug 29314), so
// the Chromium/Firefox trick — crossfade a canvas OVER the still-visible <video>
// element — is impossible: the video occludes the glyphs. First hit on iOS; the
// SAME bug bites macOS desktop Safari (an opaque z:2147483647 + translateZ(0)
// canvas still lost to the video overlay — the ASCII was drawn but never
// presented). So the real axis is the ENGINE, not the input: ascii-video.ts routes
// isTouchDevice() || isSafari() here, everything else to the 2D path. The fix
// (confirmed on-device on vshslv.com): make the CANVAS the only visible layer and
// feed it from a HIDDEN (opacity:0) <video> uploaded as a GPU texture — an
// opacity:0 overlay has nothing to paint and cannot occlude, yet still decodes +
// uploads. (main.ts skips the .hero-video src promote on WebKit for the same
// reason, so the visible element never gets a src to overlay us with.)
//
// SAME LOOK AS THE 2D PATH: this is a MODE, not an always-on backdrop. At rest
// the shader paints the smooth live video (uMix=0) — visually the same clean
// video the 2D path shows via its <video> element. On the `trail-hero` signal it
// crossfades to the ASCII render (uMix 1) and back, exactly mirroring the 2D
// engage/disengage — only the MECHANISM differs (a shader uniform instead of
// canvas opacity, because the canvas must stay opaque here). The lens follows
// the finger on touch (dissolves on touchend) or the cursor on desktop Safari
// (follows and stays, mirroring the 2D path's mouse magnetism).
//
// The pipeline is a faithful GLSL port of ascii-video.ts draw():
//   glyph CHOICE  = luminance of the (lens-warped) cell-center sample → contrast
//                   curve → ramp index → glyph from the atlas (the SAMPLED cell
//                   is warped, never the glyph position — no dark void).
//   glyph FILL    = the smooth, UN-warped per-pixel video (desktop's source-in).
//   gaps          = black (desktop's destination-over).
// All look numbers come from ./ascii-constants.ts — shared with the 2D path.

import { gsap } from "gsap";
import { isTouchDevice, prefersReducedMotion } from "../shared/device-detection.ts";
import { onLoaderFinished } from "../shared/page-loader.ts";
import { pickBgVideoSrc } from "./bg-video.ts";
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
  DPR_CAP,
} from "./ascii-constants.ts";

const IDLE_MS = 30000; // pause the source video + loop after this long with no touch
const LENS_FADE_S = 0.5; // touchend → lens dissolves back to a flat grid

const VERT = `#version 300 es
// Fullscreen triangle from gl_VertexID — no attribute buffer needed.
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uVideo;   // hidden <video> frame (object-fit: cover folded into UV)
uniform sampler2D uAtlas;   // glyph atlas: RAMP.length cells wide, white glyph on transparent
uniform vec2 uResolution;   // device px
uniform vec2 uCell;         // cellW, cellH in device px
uniform vec2 uVidOffset;    // object-fit: cover crop origin in video-UV
uniform vec2 uVidScale;     // object-fit: cover crop size in video-UV
uniform vec2 uCursor;       // finger in device px, top-left origin (-1 = none)
uniform float uRampLen;     // RAMP.length
uniform float uRadius;      // MAG_RADIUS_PX * dpr
uniform float uLens;        // MAG_LENS
uniform float uLensMul;     // 0..1 — fades the lens out on touchend
uniform float uMix;         // 0 = clean video, 1 = ASCII (the engage crossfade)
uniform float uHaveFrame;   // 0 until the first video frame is uploaded
uniform float uReveal;      // 0..1 first-load "develop": lifts the whole output up from black
uniform float uSplit;       // [EXPERIMENTS] 0..1 — left fraction rendered as the CLEAN video (0 = off)
// [EXPERIMENTS] Contrast points as uniforms (set ONCE at init, default the
// baked constants) so a dark experiment clip can widen the curve — see
// AsciiVideoOpts (ascii-video.ts).
uniform float uBlackPoint;
uniform float uWhitePoint;
out vec4 o;

const float GAMMA = ${GAMMA};
const vec3 LUMA = vec3(0.299, 0.587, 0.114);

// Gravity lens — warps WHICH source cell is sampled (never the glyph position),
// so the grid stays fully inked. Identical math to ascii-video.ts.
vec2 lens(vec2 center) {
  if (uCursor.x < 0.0 || uLensMul <= 0.0) return center;
  vec2 v = center - uCursor;
  float d = length(v);
  if (d >= uRadius) return center;
  float f = 1.0 - d / uRadius;
  return uCursor + v * (1.0 + f * f * uLens * uLensMul);
}

vec3 sampleVideo(vec2 screenUV) {
  return texture(uVideo, uVidOffset + clamp(screenUV, 0.0, 1.0) * uVidScale).rgb;
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y); // top-left origin
  if (uHaveFrame < 0.5) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }

  // Smooth, UN-warped per-pixel video — the clean-video base AND the glyph fill
  // (desktop pours the un-warped frame into the glyph shapes via source-in).
  vec3 srcPix = sampleVideo(frag / uResolution);

  // Glyph CHOICE — per cell, luminance of the lens-warped cell. Desktop reads ONE
  // pixel from a cols×rows downsample = the BOX-AVERAGE of the whole cell; a single
  // center point flickers on the high-frequency clip, so match desktop with a 2×2
  // tap average around the warped cell center.
  vec2 cell = floor(frag / uCell);
  vec2 center = (cell + 0.5) * uCell;
  vec2 wc = lens(center);
  vec2 q = uCell * 0.25;
  float lum = 0.25 * (
    dot(sampleVideo((wc + vec2(-q.x, -q.y)) / uResolution), LUMA) +
    dot(sampleVideo((wc + vec2( q.x, -q.y)) / uResolution), LUMA) +
    dot(sampleVideo((wc + vec2(-q.x,  q.y)) / uResolution), LUMA) +
    dot(sampleVideo((wc + vec2( q.x,  q.y)) / uResolution), LUMA)
  );
  float b = (lum - uBlackPoint) / (uWhitePoint - uBlackPoint);
  float cover = 0.0;
  if (b > 0.0) {
    float idx = floor(pow(clamp(b, 0.0, 1.0), GAMMA) * (uRampLen - 1.0) + 0.5);
    vec2 inCell = fract(frag / uCell);
    cover = texture(uAtlas, vec2((idx + inCell.x) / uRampLen, inCell.y)).a;
  }

  vec3 ascii = srcPix * cover;          // smooth video inside glyphs, black gaps
  // [EXPERIMENTS] Split view: fragments left of uSplit stay CLEAN video — the
  // same srcPix both halves share, so the seam is frame-exact.
  float m = frag.x < uSplit * uResolution.x ? 0.0 : uMix;
  vec3 col = mix(srcPix, ascii, m);     // crossfade: video ←→ ascii (== desktop)
  o = vec4(col * uReveal, 1.0);         // uReveal (first-load develop) lifts up from black
}`;

export function setupAsciiVideoWebGL(
  signal: AbortSignal,
  // [EXPERIMENTS] See AsciiVideoOpts (ascii-video.ts). Fed to the shader once
  // as uniforms; the defaults keep the verbatim render.
  opts: { splitFrac?: number; blackPoint?: number; whitePoint?: number } = {}
): void {
  const heroVideo = document.querySelector<HTMLVideoElement>(".hero-video");
  if (!heroVideo) return;

  // The canvas is the ONLY visible backdrop layer on WebKit (the source video is
  // hidden). Reuse the .hero-ascii class + DOM slot so it inherits the shared CSS
  // (position:fixed; inset:0; pointer-events:none) and the established stacking.
  // It must be OPAQUE — desktop crossfades opacity, here the crossfade lives in
  // the shader, so opacity stays 1.
  const canvas = document.createElement("canvas");
  canvas.className = "hero-ascii";
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.opacity = "1";
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    premultipliedAlpha: false,
    alpha: false,
  });
  if (!gl) return; // no WebGL2 (iOS <15) → stay on the plain black hero, no crash
  heroVideo.insertAdjacentElement("afterend", canvas);

  // --- the hidden frame source ----------------------------------------------
  // A SEPARATE video the module owns (the markup .hero-video stays empty/inert on
  // WebKit). 1px + opacity:0 → decodes but cannot occlude. NEVER display:none /
  // visibility:hidden (those kill the decode on iOS).
  const video = document.createElement("video");
  video.muted = true; // property, not just attribute — iOS honours the property
  video.playsInline = true;
  video.loop = true;
  video.preload = "auto";
  video.setAttribute("aria-hidden", "true");
  Object.assign(video.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "1px",
    height: "1px",
    opacity: "0",
    zIndex: "-1000",
    pointerEvents: "none",
  });
  // Reuse the exact desktop source-selection (webm probe → hevc → mp4) by copying
  // the markup element's data-* onto our own video, then asking pickBgVideoSrc.
  video.dataset.src = heroVideo.dataset.src ?? "";
  if (heroVideo.dataset.srcHevc) video.dataset.srcHevc = heroVideo.dataset.srcHevc;
  if (heroVideo.dataset.srcMp4) video.dataset.srcMp4 = heroVideo.dataset.srcMp4;
  const src = pickBgVideoSrc(video);
  if (!src) {
    canvas.remove();
    return;
  }
  video.src = src;
  document.body.appendChild(video);

  // --- GL program ------------------------------------------------------------
  const compile = (type: number, source: string): WebGLShader | null => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      gl.deleteShader(s);
      return null;
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  const program = gl.createProgram();
  if (!vs || !fs || !program) {
    canvas.remove();
    video.remove();
    return;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    canvas.remove();
    video.remove();
    return;
  }
  gl.useProgram(program);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao); // attribute-less draw still needs a bound VAO in WebGL2

  const U = (name: string): WebGLUniformLocation | null =>
    gl.getUniformLocation(program, name);
  const uResolution = U("uResolution");
  const uCell = U("uCell");
  const uVidOffset = U("uVidOffset");
  const uVidScale = U("uVidScale");
  const uCursor = U("uCursor");
  const uRadius = U("uRadius");
  const uLensMul = U("uLensMul");
  const uMix = U("uMix");
  const uHaveFrame = U("uHaveFrame");
  const uReveal = U("uReveal");
  gl.uniform1i(U("uVideo"), 0);
  gl.uniform1i(U("uAtlas"), 1);
  gl.uniform1f(U("uRampLen"), RAMP.length);
  gl.uniform1f(U("uLens"), MAG_LENS);
  gl.uniform1f(U("uSplit"), Math.min(Math.max(opts.splitFrac ?? 0, 0), 1));
  gl.uniform1f(U("uBlackPoint"), opts.blackPoint ?? BLACK_POINT);
  gl.uniform1f(U("uWhitePoint"), opts.whitePoint ?? WHITE_POINT);

  // --- glyph atlas (2D canvas → texture; the 2D pass is fine on iOS) ----------
  let dpr = 1;
  let cellW = 0;
  let cellH = 0;
  const atlasTex = gl.createTexture();
  function buildAtlas(): void {
    dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    cellH = Math.max(1, Math.round(FONT_PX * dpr));
    const a = document.createElement("canvas");
    const actx = a.getContext("2d")!;
    actx.font = `${FONT_PX * dpr}px ${FONT_STACK}`;
    cellW = Math.max(1, Math.round(actx.measureText("M").width));
    a.width = cellW * RAMP.length;
    a.height = cellH;
    actx.font = `${FONT_PX * dpr}px ${FONT_STACK}`;
    actx.textAlign = "center";
    actx.textBaseline = "middle";
    actx.fillStyle = "#fff"; // opaque white glyph = the coverage mask
    for (let i = 1; i < RAMP.length; i++) {
      actx.fillText(RAMP[i], i * cellW + cellW / 2, cellH / 2);
    }
    gl!.activeTexture(gl!.TEXTURE1);
    gl!.bindTexture(gl!.TEXTURE_2D, atlasTex);
    gl!.pixelStorei(gl!.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, a);
    // NEAREST: the atlas maps 1:1 to screen px (cellW texels → cellW device px), so
    // LINEAR buys no smoothing — it only bleeds the neighbour glyph's edge column in
    // at every cell seam (the 2D path's clipped drawImage has no such bleed).
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.NEAREST);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.NEAREST);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    gl!.uniform2f(uCell, cellW, cellH);
  }

  // --- video texture ---------------------------------------------------------
  const videoTex = gl.createTexture();
  let texAllocW = 0;
  let texAllocH = 0;
  let haveFrame = false;
  let needUpload = false;
  function uploadFrame(): void {
    if (video.readyState < 2 || !video.videoWidth) return;
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, videoTex);
    gl!.pixelStorei(gl!.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try {
      if (texAllocW !== video.videoWidth || texAllocH !== video.videoHeight) {
        gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, video);
        texAllocW = video.videoWidth;
        texAllocH = video.videoHeight;
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
        updateCover();
      } else {
        gl!.texSubImage2D(gl!.TEXTURE_2D, 0, 0, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, video);
      }
      haveFrame = true;
    } catch {
      /* frame not decodable yet — try again next tick */
    }
  }

  // object-fit: cover — same framing as the resting desktop video.
  function updateCover(): void {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    const scale = Math.max(canvas.width / vw, canvas.height / vh);
    const sw = canvas.width / scale;
    const sh = canvas.height / scale;
    gl!.uniform2f(uVidOffset, (vw - sw) / 2 / vw, (vh - sh) / 2 / vh);
    gl!.uniform2f(uVidScale, sw / vw, sh / vh);
  }

  function resize(): void {
    buildAtlas(); // re-derive dpr/cellW/cellH + atlas for the CURRENT devicePixelRatio
    canvas.width = Math.max(1, Math.round(window.innerWidth * dpr));
    canvas.height = Math.max(1, Math.round(window.innerHeight * dpr));
    gl!.viewport(0, 0, canvas.width, canvas.height);
    gl!.uniform2f(uResolution, canvas.width, canvas.height);
    gl!.uniform1f(uRadius, MAG_RADIUS_PX * dpr);
    updateCover();
  }

  // --- lens (finger) + engage state ------------------------------------------
  const reduced = prefersReducedMotion();
  const magnetism = !reduced;
  let curX = -1;
  let curY = -1;
  const lensState = { mul: 0 }; // 0..1, fades on touchend
  // 0 = video, 1 = ascii — the engage crossfade. Starts at ascii (1) when animating
  // so the FIRST decoded frame shows glyphs (the intro develops the video OUT of
  // them, mirroring desktop); reduced-motion starts at video (0), no develop.
  const mixState = { v: reduced ? 0 : 1 };
  // [INTRO] uReveal 0→1 lifts the whole output up from black — the glyphs fade in
  // from black on first load (the shader paints black until the first frame anyway),
  // then hold, then resolve to the clean video via mixState. Reduced-motion = 1.
  const revealState = { v: reduced ? 1 : 0 };
  let introTl: ReturnType<typeof gsap.timeline> | null = null;
  let introDone = reduced;
  let frameSeen = false;
  // [INTRO] Hold the develop until the loader bar completes (loaderFinished):
  // the shader keeps painting black (uReveal 0) until then, so the glyphs
  // don't develop under the black loader cover and get wasted. Reduced motion
  // has no bar (loader snaps away immediately), so it's ready at once.
  let loaderReady = reduced;
  onLoaderFinished(() => {
    loaderReady = true;
  }, signal);
  // First-load "develop" — the SAME sequence + timings as the desktop 2D path
  // (ascii-video.ts runIntroReveal), expressed through the shader: black → glyphs
  // fade up (uReveal, ENGAGE_S) → hold (INTRO_HOLD_S) → glyphs resolve to the clean
  // video (uMix 1→0, DISENGAGE_S). Kicked once the first frame is actually ready.
  function runIntroReveal(): void {
    if (introDone) return;
    introTl = gsap.timeline({
      onComplete: () => {
        introDone = true;
        introTl = null;
      },
    });
    introTl.to(revealState, { v: 1, duration: ENGAGE_S, ease: "power2.in" });
    introTl.to(
      mixState,
      { v: 0, duration: DISENGAGE_S, ease: "power2.out" },
      `+=${INTRO_HOLD_S}`
    );
  }

  // Upload only on a FRESH decoded frame where rVFC exists (iOS 15.4+, ~ the
  // clip's framerate), so the rAF loop can animate the lens/crossfade
  // independently. On iOS 15.0–15.3 (WebGL2 but no rVFC) we upload every tick
  // instead, or the texture would freeze on the first frame.
  type RVFCVideo = HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: () => void) => number;
  };
  const rvfcVideo = video as RVFCVideo;
  const hasRVFC = typeof rvfcVideo.requestVideoFrameCallback === "function";
  if (hasRVFC) {
    const onVF = (): void => {
      needUpload = true;
      rvfcVideo.requestVideoFrameCallback!(onVF);
    };
    rvfcVideo.requestVideoFrameCallback!(onVF);
  }

  // --- rAF loop --------------------------------------------------------------
  let running = false;
  let rafId = 0;
  let lastT = 0;
  const frameMs = 1000 / TARGET_FPS;
  function loop(t: number): void {
    if (!running) return;
    rafId = requestAnimationFrame(loop);
    if (document.hidden) return;
    if (t - lastT < frameMs) return;
    lastT = t;
    if (needUpload || !haveFrame || !hasRVFC) {
      uploadFrame();
      needUpload = false;
    }
    // [INTRO] Kick the develop the first time a frame is ready — the shader paints
    // black until then (uHaveFrame / uReveal 0), so the glyphs fade up from black.
    if (haveFrame && loaderReady && !frameSeen) {
      frameSeen = true;
      runIntroReveal();
    }
    gl!.uniform1f(uHaveFrame, haveFrame ? 1 : 0);
    gl!.uniform1f(uReveal, revealState.v);
    gl!.uniform2f(uCursor, curX, curY);
    gl!.uniform1f(uLensMul, magnetism ? lensState.mul : 0);
    gl!.uniform1f(uMix, mixState.v);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
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

  // --- idle pause --------------------------------------------------------------
  let idleTimer = 0;
  function play(): void {
    const p = video.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }
  function markActive(): void {
    if (video.paused) {
      play();
      startLoop();
    }
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      video.pause(); // freeze on the last frame (the canvas keeps painting it)
      stopLoop();
    }, IDLE_MS);
  }

  // --- input -----------------------------------------------------------------
  function onTouchMove(e: TouchEvent): void {
    const tch = e.touches[0];
    if (!tch) return;
    curX = tch.clientX * dpr;
    curY = tch.clientY * dpr;
    gsap.killTweensOf(lensState);
    lensState.mul = 1;
    markActive();
  }
  function onTouchStart(e: TouchEvent): void {
    const tch = e.touches[0];
    if (tch) {
      curX = tch.clientX * dpr;
      curY = tch.clientY * dpr;
    }
    gsap.killTweensOf(lensState);
    lensState.mul = 1;
    markActive(); // first gesture unblocks iOS muted-autoplay
  }
  function onTouchEnd(): void {
    // Lens dissolves back to a flat grid.
    gsap.to(lensState, { mul: 0, duration: LENS_FADE_S, ease: "power2.out" });
  }
  // Desktop Safari: the SAME renderer, driven by the mouse instead of a finger.
  // Mirrors the 2D path's magnetism (ascii-video.ts onPointerMove) — the lens
  // follows the cursor and STAYS (no touchend, so no fade-out). markActive fires
  // regardless of reduced-motion so mouse movement re-kicks the idle-paused video
  // (the visible .hero-video is unloaded on Safari, so we own the only source).
  function onPointerMove(e: PointerEvent): void {
    markActive();
    if (!magnetism) return;
    curX = e.clientX * dpr;
    curY = e.clientY * dpr;
    gsap.killTweensOf(lensState);
    lensState.mul = 1;
  }

  // --- engage / disengage (the SAME trail-hero signal desktop rides) ---------
  // hidden:true  → video disintegrates into glyphs (uMix→1)
  // hidden:false → glyphs resolve back to clean video (uMix→0)
  // Always-on canvas: only the uniform crossfades, never the canvas opacity.
  function onTrailHero(e: Event): void {
    const detail = (e as CustomEvent<{ hidden: boolean; instant: boolean }>).detail;
    if (!detail) return;
    // [INTRO] If the trail engages/disengages mid-develop, abandon the intro and
    // snap the reveal to full — the mixState tween below takes over the crossfade.
    if (!introDone) {
      introTl?.kill();
      introTl = null;
      introDone = true;
      revealState.v = 1;
    }
    startLoop(); // a programmatic engage can arrive while idle-paused — repaint it
    gsap.killTweensOf(mixState);
    if (detail.instant) {
      mixState.v = detail.hidden ? 1 : 0;
      return;
    }
    gsap.to(mixState, {
      v: detail.hidden ? 1 : 0,
      duration: detail.hidden ? ENGAGE_S : DISENGAGE_S,
      ease: detail.hidden ? "power2.in" : "power2.out",
    });
  }

  // Debounced resize.
  let resizeRaf = 0;
  function onResize(): void {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(resize);
  }

  // --- mount -----------------------------------------------------------------
  resize(); // builds the atlas (dpr/cellW/cellH) then sizes the drawing buffer
  startLoop();
  play(); // best-effort; iOS may defer until the first touch (onTouchStart re-kicks)
  markActive();
  // Input depends on the device, NOT on which engine routed us here: touch gets the
  // finger lens (+ touchstart to unblock iOS muted-autoplay); a mouse (desktop
  // Safari) gets the cursor lens. Desktop muted-autoplay isn't gestured-gated, so
  // the play() above is enough there — no pointerdown re-kick needed.
  if (isTouchDevice()) {
    document.body.addEventListener("touchstart", onTouchStart, { passive: true, signal });
    document.body.addEventListener("touchmove", onTouchMove, { passive: true, signal });
    document.body.addEventListener("touchend", onTouchEnd, { passive: true, signal });
  } else {
    window.addEventListener("pointermove", onPointerMove, { signal });
  }
  window.addEventListener("trail-hero", onTrailHero, { signal });
  window.addEventListener("resize", onResize, { signal });

  signal.addEventListener("abort", () => {
    introTl?.kill();
    stopLoop();
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    if (idleTimer) clearTimeout(idleTimer);
    gsap.killTweensOf(lensState);
    gsap.killTweensOf(mixState);
    gsap.killTweensOf(revealState);
    gl.deleteTexture(videoTex);
    gl.deleteTexture(atlasTex);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
    // Deleting child objects does NOT release the WebGL2 context — and iOS caps
    // live contexts (~16) per page. Without an explicit drop, repeated re-mounts
    // pile contexts up until getContext returns null and the hero goes black.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    canvas.remove();
    video.pause();
    video.removeAttribute("src");
    video.load(); // stop the decoder
    video.remove();
  });
}
