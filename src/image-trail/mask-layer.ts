// [GRID-WINDOW] Trail cards as interactive scan windows.
//
// Each visible card renders in four layers:
//   BASE     — the mask clip (cover-crop of the viewport-fixed field), slightly
//              darkened, drawn directly as video pixels.
//   GLITCH   — coarse-grid cells within GLITCH_RADIUS of the cursor get a
//              displaced redraw: the source rect is shifted by a seeded random
//              offset (like the scan-overlay-tool displacement), giving a
//              "dropped detection" look. The seed mutates slowly (GLITCH_SPEED
//              z-slices/sec) so cells pulse rather than flicker per-frame.
//   ASCII    — cells within ASCII_RADIUS show fine-glyph ASCII (same Bourke
//              ramp + video-fill pipeline as the old CODE-WINDOWS), replacing
//              the base image with a black backing + video-filled glyphs.
//   GRID     — thin hairlines at every GRID_CELL_PX boundary, plus raw-data
//              labels ([row:col] / UV coords) in the ASCII zone cells.
//
// Pipeline per frame:
//   1. Downsample clip → fine-lum grid (same as before, for ASCII glyph choice).
//   2. Per card: draw base video + darken.
//   3. Per card: overdraw glitch cells (displaced clip + seam).
//   4. Per card: write black backing + glyph alpha mask to offscreen canvas.
//   5. Pour clip into glyph canvas (source-in), composite onto visible canvas.
//   6. Per card: draw grid lines + data labels.
//
// The trail ENGINE (pool / input / dismissal / toggle) is untouched.
// WebKit-safe: the clip is hidden (1px, opacity:0); visible layer is canvas.

import { gsap } from "gsap";
import { isTouchDevice, prefersReducedMotion } from "../shared/device-detection.ts";
import type { TrailCtx } from "./context.ts";
import {
  RAMP,
  CHARS,
  CHAR_INDEX,
  FONT_PX,
  FONT_STACK,
  GAMMA,
  TARGET_FPS,
  DPR_CAP,
  WIN_BLACK_POINT,
  WIN_WHITE_POINT,
} from "../ascii/ascii-constants.ts";
import { h01 } from "../ascii/field-noise.ts";
import { gridConfig } from "./grid-config.ts";

const MASK_SRC = "/media/mask.mp4";
const VISIBLE_EPS = 0.05;
const LENS_FADE_S = 0.5;

// Extra hairline on displaced cells to "sell the seam".
const GLITCH_SEAM_ALPHA = 0.18;

interface CardRect {
  x: number; // device px
  y: number;
  w: number;
  h: number;
  op: number; // 0..1 opacity from GSAP
}

// Fast integer hash → [0,1). Used for stable per-cell glitch decisions that
// change only when `timeSlice` changes (GLITCH_SPEED slices/sec), so glitch
// cells pulse slowly rather than re-randomising every frame.
function stableHash(a: number, b: number, t: number): number {
  let h = (a * 1664525 + b * 22695477 + t * 1013904223) | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b) | 0;
  return (((h ^ (h >>> 16)) >>> 0) / 0xffffffff);
}


export function setupMaskLayer(ctx: TrailCtx): void {
  const inst = ctx.imageTrail;
  if (!inst) return;
  const wrap = inst.DOM.el;

  // --- hidden source video (same decode-without-occlusion pattern) ----------
  const video = document.createElement("video");
  video.muted = true;
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
  video.src = MASK_SRC;
  document.body.appendChild(video);
  const play = (): void => {
    const p = video.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  };
  play();
  window.addEventListener("touchstart", play, {
    once: true,
    passive: true,
    signal: ctx.signal,
  });

  // visible full-viewport canvas
  const canvas = document.createElement("canvas");
  canvas.className = "trail-mask";
  canvas.setAttribute("aria-hidden", "true");
  wrap.appendChild(canvas);
  const mctx = canvas.getContext("2d");

  // offscreen glyph-compose canvas (alpha mask → source-in video pour)
  const glyphs = document.createElement("canvas");
  const gctx = glyphs.getContext("2d");

  // tiny downsample canvas for luminance sampling
  const sample = document.createElement("canvas");
  const sctx = sample.getContext("2d", { willReadFrequently: true });

  if (!mctx || !gctx || !sctx) {
    canvas.remove();
    video.remove();
    return;
  }

  // --- geometry (device px) -------------------------------------------------
  let dpr = 1;
  let cellW = 0; // fine ASCII cell width  (device px)
  let cellH = 0; // fine ASCII cell height (device px)
  let cols = 0;  // fine grid cols across viewport
  let rows = 0;  // fine grid rows
  let atlas: HTMLCanvasElement | null = null;

  function buildAtlas(): void {
    dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    cellH = Math.max(1, Math.round(FONT_PX * dpr));
    mctx!.font = `${FONT_PX * dpr}px ${FONT_STACK}`;
    cellW = Math.max(1, Math.round(mctx!.measureText("M").width));

    const a = atlas ?? document.createElement("canvas");
    a.width = cellW * (RAMP.length + CHARS.length);
    a.height = cellH;
    const actx = a.getContext("2d")!;
    actx.clearRect(0, 0, a.width, a.height);
    actx.font = `${FONT_PX * dpr}px ${FONT_STACK}`;
    actx.textAlign = "center";
    actx.textBaseline = "middle";
    actx.fillStyle = "#fff";
    for (let i = 1; i < RAMP.length; i++) {
      actx.fillText(RAMP[i], i * cellW + cellW / 2, cellH / 2);
    }
    for (let i = 0; i < CHARS.length; i++) {
      actx.fillText(CHARS[i], (RAMP.length + i) * cellW + cellW / 2, cellH / 2);
    }
    atlas = a;
  }

  function resize(): void {
    buildAtlas();
    const w = Math.max(1, Math.round(window.innerWidth * dpr));
    const h = Math.max(1, Math.round(window.innerHeight * dpr));
    canvas.width = w;
    canvas.height = h;
    glyphs.width = w;
    glyphs.height = h;
    cols = Math.ceil(w / cellW);
    rows = Math.ceil(h / cellH);
    sample.width = cols;
    sample.height = rows;
  }
  resize();
  window.addEventListener("resize", resize, { signal: ctx.signal });

  // Permanently revealed cells: once the cursor passes over a cell, it stays
  // visible forever. Maps "gc,gr" → timestamp when first revealed (for
  // a quick fade-in). Works as a "scratch-off" painting effect.
  const revealedCells = new Map<string, number>();

  // Cards from the last render frame — kept so the pointer handler can reveal
  // cells between render frames (at native pointer rate, not 24 fps).
  let cachedCards: CardRect[] = [];

  // --- cursor tracking (device px) ------------------------------------------
  let curX = -1;
  let curY = -1;
  const lensState = { mul: 0 };
  const magnetism = !prefersReducedMotion();

  // Reveal cells around a cursor position (device px).
  // No card-range restriction here — we mark every cell within revRad of the
  // cursor regardless of card bounds.  The render passes enforce cellRange
  // themselves, so extra entries in revealedCells are harmless (they simply
  // never match any cell in a cellRange iteration and are never drawn).
  // Removing the card-range check eliminates false negatives in the edge strip
  // (the ~0..gcW strip between card.x and the first fully-contained cell).
  const revealAt = (px: number, py: number, nowMs: number): void => {
    const gcW = Math.round(gridConfig.gridCellPx * dpr);
    const revRad = gridConfig.revealRadius;
    const rCeil = Math.ceil(revRad);
    const gcX = px / gcW;
    const gcY = py / gcW;
    const gcAt = Math.floor(gcX);
    const grAt = Math.floor(gcY);
    for (let dgr = -rCeil; dgr <= rCeil; dgr++) {
      for (let dgc = -rCeil; dgc <= rCeil; dgc++) {
        const gc = gcAt + dgc, gr = grAt + dgr;
        const dx = gc + 0.5 - gcX, dy = gr + 0.5 - gcY;
        if (Math.sqrt(dx * dx + dy * dy) >= revRad) continue;
        const key = `${gc},${gr}`;
        if (!revealedCells.has(key)) revealedCells.set(key, nowMs);
      }
    }
  };

  if (magnetism) {
    if (isTouchDevice()) {
      const onTouch = (e: TouchEvent): void => {
        if (e.touches.length === 0) return;
        gsap.killTweensOf(lensState);
        lensState.mul = 1;
        const nowMs = performance.now();
        // Use the first touch point to update cursor position (for glitch pass).
        const t0 = e.touches[0];
        curX = t0.clientX * dpr;
        curY = t0.clientY * dpr;
        // Reveal at every active touch point that is over a card.
        for (let i = 0; i < e.touches.length; i++) {
          const t = e.touches[i];
          const tx = t.clientX * dpr;
          const ty = t.clientY * dpr;
          const overCard = cachedCards.some(
            c => tx >= c.x && tx < c.x + c.w && ty >= c.y && ty < c.y + c.h
          );
          if (overCard) revealAt(tx, ty, nowMs);
        }
      };
      window.addEventListener("touchstart", onTouch, { passive: true, signal: ctx.signal });
      window.addEventListener("touchmove", onTouch, { passive: true, signal: ctx.signal });
      window.addEventListener(
        "touchend",
        () => {
          gsap.to(lensState, { mul: 0, duration: LENS_FADE_S, ease: "power2.out" });
        },
        { passive: true, signal: ctx.signal }
      );
    } else {
      window.addEventListener(
        "pointermove",
        (e: PointerEvent) => {
          curX = e.clientX * dpr;
          curY = e.clientY * dpr;
          lensState.mul = 1;
          // Only reveal when cursor is over a visible card (layer 1).
          // cellOp handles opacity; revealAt is called at native pointer rate
          // so fast cursor movement never skips cells.
          const overCard = cachedCards.some(
            c => curX >= c.x && curX < c.x + c.w && curY >= c.y && curY < c.y + c.h
          );
          if (overCard) revealAt(curX, curY, performance.now());
        },
        { signal: ctx.signal }
      );
    }
  }

  // --- per-frame render ------------------------------------------------------
  let lastT = 0;
  const frameMs = 1000 / TARGET_FPS;

  const draw = (): void => {
    const nowMs = performance.now();
    if (nowMs - lastT < frameMs) return;
    lastT = nowMs;

    mctx!.clearRect(0, 0, canvas.width, canvas.height);
    if (!atlas || video.readyState < 2 || !video.videoWidth) return;

    // Collect visible cards (read GSAP transforms, no layout).
    const cards: CardRect[] = [];
    for (const im of inst.images) {
      const el = im.DOM.el;
      const op = gsap.getProperty(el, "opacity") as number;
      if (op <= VISIBLE_EPS) continue;
      const sx = (gsap.getProperty(el, "scaleX") as number) || 1;
      const sy = (gsap.getProperty(el, "scaleY") as number) || 1;
      if (sx <= 0.01 || sy <= 0.01) continue;
      const x = gsap.getProperty(el, "x") as number;
      const y = gsap.getProperty(el, "y") as number;
      const w = im.rect.width;
      const h = im.rect.height;
      cards.push({
        x: Math.round((x + (w * (1 - sx)) / 2) * dpr),
        y: Math.round((y + (h * (1 - sy)) / 2) * dpr),
        w: Math.round(w * sx * dpr),
        h: Math.round(h * sy * dpr),
        op: op < 1 ? op : 1,
      });
    }
    if (cards.length === 0) return;
    // Keep a snapshot for the pointer handler which runs between render frames.
    cachedCards = cards;

    // Cover-crop: map canvas viewport → video source rect (object-fit: cover).
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.max(canvas.width / vw, canvas.height / vh);
    const srcW = canvas.width / scale;
    const srcH = canvas.height / scale;
    const srcX = (vw - srcW) / 2;
    const srcY = (vh - srcH) / 2;

    // Downsample clip to one luminance sample per fine grid cell.
    sctx!.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, cols, rows);
    let lum: Uint8ClampedArray;
    try {
      lum = sctx!.getImageData(0, 0, cols, rows).data;
    } catch {
      return;
    }

    // Coarse grid cell size in device px — VIEWPORT-FIXED.
    // Grid lines sit at multiples of gcW/gcH regardless of any card position.
    // Cards are windows: they clip the same continuous underlying grid.
    const gcW = Math.round(gridConfig.gridCellPx * dpr);
    const gcH = gcW;

    const tSec = nowMs / 1000;
    const timeSlice = Math.floor(tSec * gridConfig.glitchSpeed);
    const effectMul = lensState.mul;
    const cursorActive = magnetism && curX >= 0 && effectMul > 0.01;
    const glitchRad = gridConfig.glitchRadius * effectMul;

    // Cursor in VIEWPORT grid coords (fractional cell index).
    const curGcX = curX / gcW;
    const curGcY = curY / gcH;

    // ── THREE-LAYER GLOBAL ARCHITECTURE ──────────────────────────────────────
    // Layer 1 (bottom): card DOM images — always visible behind the canvas.
    // Layer 2: mask.mp4 video cells — drawn on canvas in revealed cells.
    // Layer 3: ASCII cells            — drawn on canvas in revealed cells.
    // All three layers share the same viewport-fixed coordinate system.
    // No per-card clipping in the render passes — every cell is drawn at
    // gc*gcW, gr*gcH (always grid-aligned, never staircase artefacts).
    //
    // cellOp: opacity for a cell = max opacity of any card whose rect
    // INTERSECTS this cell.  Intersection (not full-containment) means every
    // cell that touches a card — including the edge strip — is visible and
    // responsive to hover.
    const cellOp = (gc: number, gr: number): number => {
      const cx0 = gc * gcW, cy0 = gr * gcH;
      const cx1 = cx0 + gcW, cy1 = cy0 + gcH;
      let op = 0;
      for (const c of cards) {
        if (cx0 < c.x + c.w && cx1 > c.x && cy0 < c.y + c.h && cy1 > c.y)
          op = Math.max(op, c.op);
      }
      return op;
    };

    // Stable per-viewport-cell ASCII/video split (no card param needed).
    const isAscii = (gc: number, gr: number): boolean =>
      h01(gc, gr, 1337) < gridConfig.asciiShare;

    // Parse "gc,gr" key to [gc, gr].
    const parseKey = (key: string): [number, number] => {
      const i = key.indexOf(",");
      return [parseInt(key, 10), parseInt(key.slice(i + 1), 10)];
    };

    // ── PASS 1: VIDEO cells (global) ──────────────────────────────────────────
    // Iterate revealedCells directly — no card loop, no per-card clipping.
    // Every cell is drawn at gc*gcW (grid-aligned by construction).
    for (const [key] of revealedCells) {
      const [gc, gr] = parseKey(key);
      if (isAscii(gc, gr)) continue;
      const op = cellOp(gc, gr);
      if (op < 0.01) continue;
      const cx0 = gc * gcW, cy0 = gr * gcH;
      if (cx0 + gcW <= 0 || cy0 + gcH <= 0 || cx0 >= canvas.width || cy0 >= canvas.height) continue;
      const cSrcX = srcX + cx0 / scale, cSrcY = srcY + cy0 / scale;
      const cSrcW = gcW / scale, cSrcH = gcH / scale;
      if (cSrcX >= vw || cSrcY >= vh || cSrcX + cSrcW <= 0 || cSrcY + cSrcH <= 0) continue;
      const sx0 = Math.max(0, cSrcX), sy0 = Math.max(0, cSrcY);
      const sw = Math.min(cSrcW, vw - sx0), sh = Math.min(cSrcH, vh - sy0);
      if (sw <= 0 || sh <= 0) continue;
      mctx!.globalAlpha = op;
      mctx!.drawImage(video, sx0, sy0, sw, sh, cx0, cy0, gcW, gcH);
      mctx!.fillStyle = `rgba(0,0,0,${gridConfig.baseDarken})`;
      mctx!.fillRect(cx0, cy0, gcW, gcH);
    }
    mctx!.globalAlpha = 1;

    // ── PASS 3: ASCII cells (global) ──────────────────────────────────────────
    gctx!.globalCompositeOperation = "source-over";
    gctx!.clearRect(0, 0, glyphs.width, glyphs.height);
    const last = RAMP.length - 1;
    const asciiDrawList: Array<[number, number, number]> = [];

    for (const [key] of revealedCells) {
      const [gc, gr] = parseKey(key);
      if (!isAscii(gc, gr)) continue;
      const op = cellOp(gc, gr);
      if (op < 0.01) continue;
      const cx0 = gc * gcW, cy0 = gr * gcH;
      if (cx0 + gcW <= 0 || cy0 + gcH <= 0 || cx0 >= canvas.width || cy0 >= canvas.height) continue;
      asciiDrawList.push([gc, gr, op]);

      mctx!.globalAlpha = op;
      mctx!.fillStyle = "#000";
      mctx!.fillRect(cx0, cy0, gcW, gcH);

      const fc0 = Math.max(0, Math.floor(cx0 / cellW));
      const fc1 = Math.min(cols - 1, Math.floor((cx0 + gcW - 1) / cellW));
      const fr0 = Math.max(0, Math.floor(cy0 / cellH));
      const fr1 = Math.min(rows - 1, Math.floor((cy0 + gcH - 1) / cellH));
      for (let fr = fr0; fr <= fr1; fr++) {
        for (let fc = fc0; fc <= fc1; fc++) {
          const p = (fr * cols + fc) * 4;
          const l = (0.299 * lum[p] + 0.587 * lum[p + 1] + 0.114 * lum[p + 2]) / 255;
          let b = (l - WIN_BLACK_POINT) / (WIN_WHITE_POINT - WIN_BLACK_POINT);
          if (b <= 0) continue;
          if (b > 1) b = 1;
          const idx = Math.round(Math.pow(b, GAMMA) * last);
          if (idx <= 0) continue;
          gctx!.drawImage(atlas!, idx * cellW, 0, cellW, cellH,
                          fc * cellW, fr * cellH, cellW, cellH);
        }
      }
    }
    mctx!.globalAlpha = 1;

    gctx!.globalCompositeOperation = "source-in";
    gctx!.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, glyphs.width, glyphs.height);
    gctx!.globalCompositeOperation = "source-over";

    for (const [gc, gr, op] of asciiDrawList) {
      const cx0 = gc * gcW, cy0 = gr * gcH;
      mctx!.save();
      mctx!.globalAlpha = op;
      mctx!.beginPath();
      mctx!.rect(cx0, cy0, gcW, gcH);
      mctx!.clip();
      mctx!.drawImage(glyphs, 0, 0);
      mctx!.restore();
    }

    // ── PASS 2: GLITCH (global, cursor-proximity) ──────────────────────────────
    if (cursorActive) {
      const gcAt = Math.floor(curGcX);
      const grAt = Math.floor(curGcY);
      const gCeil = Math.ceil(glitchRad);
      for (let dgr = -gCeil; dgr <= gCeil; dgr++) {
        for (let dgc = -gCeil; dgc <= gCeil; dgc++) {
          const gc = gcAt + dgc, gr = grAt + dgr;
          const dx = gc + 0.5 - curGcX, dy = gr + 0.5 - curGcY;
          if (Math.sqrt(dx * dx + dy * dy) >= glitchRad) continue;
          if (stableHash(gc, gr, timeSlice) >= gridConfig.glitchChance) continue;
          const op = cellOp(gc, gr);
          if (op < 0.01) continue;
          const cx0 = gc * gcW, cy0 = gr * gcH;
          const h2 = stableHash(gc + 100, gr + 200, timeSlice);
          const h3 = stableHash(gc + 300, gr + 400, timeSlice);
          const offX = (h2 * 2 - 1) * gridConfig.glitchAmt * (gcW / scale);
          const offY = (h3 * 2 - 1) * gridConfig.glitchAmt * (gcH / scale);
          const gSrcX = srcX + cx0 / scale + offX, gSrcY = srcY + cy0 / scale + offY;
          const gSrcW = gcW / scale, gSrcH = gcH / scale;
          if (gSrcX >= vw || gSrcY >= vh || gSrcX + gSrcW <= 0 || gSrcY + gSrcH <= 0) continue;
          mctx!.save();
          mctx!.globalAlpha = op;
          mctx!.beginPath();
          mctx!.rect(cx0, cy0, gcW, gcH);
          mctx!.clip();
          mctx!.drawImage(video,
            Math.max(0, gSrcX), Math.max(0, gSrcY),
            Math.min(gSrcW, vw - Math.max(0, gSrcX)),
            Math.min(gSrcH, vh - Math.max(0, gSrcY)),
            cx0, cy0, gcW, gcH);
          mctx!.strokeStyle = `rgba(255,255,255,${GLITCH_SEAM_ALPHA})`;
          mctx!.lineWidth = 1;
          mctx!.strokeRect(cx0 + 0.5, cy0 + 0.5, gcW - 1, gcH - 1);
          mctx!.restore();
        }
      }
    }

    // ── PASS 4: GRID LINES ─────────────────────────────────────────────────────
    // Clipped to each card's original rect so grid hairlines cover the full card
    // including the edge strip. Lines themselves land on gc*gcW (grid-aligned).
    {
      const gcBounds = new Set<number>();
      const grBounds = new Set<number>();
      let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
      let hasCard = false;

      mctx!.save();
      mctx!.beginPath();
      for (const c of cards) {
        if (c.w <= 0 || c.h <= 0) continue;
        hasCard = true;
        mctx!.rect(c.x, c.y, c.w, c.h);
        const gcF = Math.floor(c.x / gcW);
        const gcL = Math.ceil((c.x + c.w) / gcW);
        const grF = Math.floor(c.y / gcH);
        const grL = Math.ceil((c.y + c.h) / gcH);
        for (let gc = gcF; gc <= gcL; gc++) gcBounds.add(gc);
        for (let gr = grF; gr <= grL; gr++) grBounds.add(gr);
        xMin = Math.min(xMin, gcF * gcW);
        xMax = Math.max(xMax, gcL * gcW);
        yMin = Math.min(yMin, grF * gcH);
        yMax = Math.max(yMax, grL * gcH);
      }
      if (hasCard) {
        mctx!.clip();
        mctx!.strokeStyle = `rgba(255,255,255,${gridConfig.gridLineAlpha})`;
        mctx!.lineWidth = 1;
        for (const gc of gcBounds) {
          const x = gc * gcW + 0.5;
          mctx!.beginPath(); mctx!.moveTo(x, yMin); mctx!.lineTo(x, yMax); mctx!.stroke();
        }
        for (const gr of grBounds) {
          const y = gr * gcH + 0.5;
          mctx!.beginPath(); mctx!.moveTo(xMin, y); mctx!.lineTo(xMax, y); mctx!.stroke();
        }
      }
      mctx!.restore();
    }

    mctx!.globalAlpha = 1;

  };

  gsap.ticker.add(draw);

  ctx.signal.addEventListener("abort", () => {
    gsap.ticker.remove(draw);
    gsap.killTweensOf(lensState);
    canvas.remove();
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
  });
}
