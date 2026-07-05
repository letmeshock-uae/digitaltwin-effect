// The trail pool's box sequence — orientation drives each card's aspect
// (4:3 / 3:4 via the --trail-unit CSS, see style.css). The cards carry no
// image any more ([MASK] — they're windows onto mask.mp4, painted by
// image-trail/mask-layer.ts); the sequence is kept from the original
// vshslv.com pool so the trail's size rhythm reads the same.

export type TrailOrientation = "horizontal" | "vertical";

export const TRAIL_ORIENTATIONS: TrailOrientation[] = [
  "horizontal", "vertical", "vertical", "vertical", "vertical", "vertical",
  "horizontal", "vertical", "vertical", "vertical", "horizontal", "vertical",
  "vertical", "vertical", "vertical", "vertical", "horizontal", "horizontal",
  "vertical", "horizontal", "vertical", "horizontal", "horizontal",
];
