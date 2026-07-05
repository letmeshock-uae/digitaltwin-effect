// Mutable runtime config for the grid-window mask layer.
// mask-layer.ts reads these per-frame so live slider changes apply instantly.
// Defaults mirror the ascii-constants.ts values.

export interface GridConfig {
  /** Coarse grid cell size in CSS px. */
  gridCellPx: number;
  /** Fraction of cells showing ASCII (0 = all video, 1 = all ASCII).
   *  Determined per viewport cell by a stable hash — same cell is always
   *  the same mode across all cards. */
  asciiShare: number;
  /** Grid cell radius around cursor → cells are permanently revealed (paint
   *  effect — revealed cells stay visible even after cursor moves away). */
  revealRadius: number;
  /** Grid cell radius around cursor → data labels appear on ASCII cells. */
  asciiRadius: number;
  /** Grid cell radius → glitch/displacement zone (cursor-driven). */
  glitchRadius: number;
  /** Per-eligible-cell probability of displacement [0, 1]. */
  glitchChance: number;
  /** Max displacement as fraction of cell size [0, 1]. */
  glitchAmt: number;
  /** Glitch seed mutation rate (z-slices / sec). */
  glitchSpeed: number;
  /** Base video darken overlay opacity [0, 1]. */
  baseDarken: number;
  /** Coarse grid hairline opacity [0, 1]. */
  gridLineAlpha: number;
  /** Data-label text opacity [0, 1]. */
  labelAlpha: number;
}

export const gridConfig: GridConfig = {
  gridCellPx:    80,
  asciiShare:    0.80,
  revealRadius:  2.0,
  asciiRadius:   1.8,
  glitchRadius:  3.8,
  glitchChance:  0.42,
  glitchAmt:     0.52,
  glitchSpeed:   0.9,
  baseDarken:    0.28,
  gridLineAlpha: 0.10,
  labelAlpha:    0.55,
};
