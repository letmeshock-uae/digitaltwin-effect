// Hero ASCII backdrop — the SHARED look constants.
//
// Single source of truth for BOTH renderers so the desktop and mobile paths can
// never drift (CLAUDE.md "reuse in full / one source of truth"):
//   - desktop  = the 2D-canvas crossfade MODE  (ascii-video.ts)
//   - touch/iOS = the WebGL2 fragment-shader path (ascii-video-webgl.ts)
// The 2D path reads these as JS; the WebGL path bakes BLACK_POINT/WHITE_POINT/
// GAMMA into the shader and feeds MAG_* as uniforms — same numbers, so the two
// look identical. The magnetism lens MATH itself is necessarily expressed twice
// (JS in the 2D draw, GLSL in the shader); keeping the CONSTANTS here is what
// guarantees they stay in lockstep.

// Bourke 70-level ramp, DENSEST → lightest ink; reversed so index 0 = blank
// (dark pixel → no glyph) and the last index = the heaviest glyph (bright pixel).
const RAMP_DENSE_FIRST =
  "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. ";
export const RAMP = [...RAMP_DENSE_FIRST].reverse().join(""); // light → dense

// Tunables — the whole look + transition lives here.
export const FONT_PX = 9; // cell height in CSS px (smaller = finer, more glyphs/frame)
export const FONT_STACK = `ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Code", monospace`;
// Contrast curve — pixels below BLACK_POINT are BLANK (the subject emerges from
// black), the rest is remapped into [BLACK_POINT, WHITE_POINT] then GAMMA-shaped
// (>1 deepens midtones so the grid isn't a uniform fill).
export const BLACK_POINT = 0.16;
export const WHITE_POINT = 0.92;
export const GAMMA = 1.25;
export const TARGET_FPS = 24;
export const ENGAGE_S = 0.45; // video → ascii crossfade in
export const DISENGAGE_S = 0.6; // ascii → video crossfade out
// First-load intro "develop" — the hero video RESOLVES OUT of the ASCII glyph
// field on load instead of popping in (black → glyphs fade in [ENGAGE_S] → hold
// [INTRO_HOLD_S] → video resolves out [DISENGAGE_S]). Shared so the 2D + WebGL
// paths hold the glyphs for the same beat.
export const INTRO_HOLD_S = 0.35;
// [MAGNETISM] Cursor/finger lens on the glyph field. RADIUS = influence reach (CSS
// px, pushed wide so it reaches past the trail thumbs into the visible ASCII).
// LENS = gravity strength: how much FARTHER from the cursor each cell SAMPLES, so
// the surrounding scene is drawn inward and the ASCII compresses toward the cursor
// (0 = off, higher = stronger pinch). No glyphs are MOVED → no dark void.
export const MAG_RADIUS_PX = 300;
export const MAG_LENS = 1.8;
// devicePixelRatio cap — crisp on HiDPI without paying for 3× buffers on phones.
export const DPR_CAP = 2;

// ============================================================================
// [CODE-WINDOWS] The trail cards are windows of CODE — each visible card
// renders the mask clip as this same ramp-ASCII (image-trail/mask-layer.ts;
// the ascii modules above stay verbatim and only ever paint the one-shot
// intro develop — the steady-state code lives ONLY in the trail forms,
// owner's call). The card rims are TORN: rim-noise eats up to TORN_DEPTH
// cells inward — at the very rim only ~TORN_KEEP of cells survive (ragged
// spikes), deepening to full coverage — and the noise evolves in place
// (TORN_EVOLVE z-slices/sec) so the tear shimmers alive without sliding.
// DATA_ROW_SHARE of the grid's rows swap the ramp for crawling telemetry
// tickers (each row's direction from its hash — mixed, never one uniform
// slide), surfacing only inside the windows.
// ============================================================================
export const TORN_DEPTH = 3; // cells the noise may eat inward from a window rim
export const TORN_KEEP = 0.12; // survival share at the very rim (ragged spikes)
export const TORN_SCALE = 5; // rim-noise feature size, rows
export const TORN_EVOLVE = 0.1; // rim-noise z-slices/sec (the tear shimmers)
// The windows' OWN contrast curve — the mask clip is dark (measured: p50≈0.03,
// p75≈0.13, p97≈0.7), so the backdrop's BLACK_POINT 0.16 would blank ~80% of
// every window into a black box. 0.04 keeps the true blacks blank (the subject
// still emerges from black) while the bright subject spans the whole ramp.
export const WIN_BLACK_POINT = 0.04;
export const WIN_WHITE_POINT = 0.7;
export const DATA_ROW_SHARE = 0.22; // share of rows that render telemetry
export const DATA_CRAWL = 3; // cells/sec data-row ticker speed

// ============================================================================
// [GRID-WINDOW] Grid-based interactive overlay on trail cards.
// GRID_CELL_PX  — coarse cell size in CSS px (holds multiple fine ASCII cells).
// ASCII_RADIUS  — grid-cell distance from cursor → switch to ASCII render.
// GLITCH_RADIUS — grid-cell distance → displacement glitch zone.
// GLITCH_CHANCE — per-eligible-cell probability of applying displacement.
// GLITCH_AMT    — max displacement as fraction of the grid cell size.
// GLITCH_SPEED  — z slices/sec driving the per-cell random seed, so the
//                 glitch pattern slowly mutates rather than flickering.
// ============================================================================
export const GRID_CELL_PX = 40;
export const ASCII_RADIUS = 1.8;
export const GLITCH_RADIUS = 3.8;
export const GLITCH_CHANCE = 0.42;
export const GLITCH_AMT = 0.52;
export const GLITCH_SPEED = 0.9;

const TWIN_RECORDS = [
  '"twin_id":"TWN-RD-00231" "asset":"Al Wasl Road, Segment 14" "status":"degraded" "condition_score":42 "last_inspection":"2025-11-02" "sensor_temp_c":38.6 "history_points":214',
  '"twin_id":"TWN-RD-00232" "asset":"Sheikh Zayed Road, Segment 03" "status":"nominal" "condition_score":87 "last_inspection":"2025-12-18" "sensor_temp_c":41.2 "history_points":508',
  '"twin_id":"TWN-BR-00107" "asset":"Business Bay Crossing, Deck B" "status":"watch" "condition_score":63 "last_inspection":"2025-10-27" "sensor_temp_c":36.9 "history_points":132',
  '"twin_id":"TWN-RD-00318" "asset":"Jumeirah Beach Road, Segment 22" "status":"nominal" "condition_score":91 "last_inspection":"2026-01-09" "sensor_temp_c":39.4 "history_points":347',
];
export const DATA_TEXT = TWIN_RECORDS.join("  ") + "  ";

// The deduplicated data alphabet, appended to the atlas AFTER the ramp: a data
// cell's atlas index = RAMP.length + CHAR_INDEX[ch], so one atlas serves both
// glyph sources.
export const CHARS = [...new Set(DATA_TEXT)].join("");
export const CHAR_INDEX: Record<string, number> = {};
for (let i = 0; i < CHARS.length; i++) CHAR_INDEX[CHARS[i]] = i;
