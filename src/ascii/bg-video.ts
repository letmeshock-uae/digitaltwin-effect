// Background hero-video source selection. Shared by home/image-trail.ts
// (the magic-off promote path) and home/main.ts (ensureBgVideoLoaded) —
// extracted so neither has to import the other (which would cycle).
//
// Source ladder: webm (VP9, Chrome/Firefox) → hevc (H.265, Safari/iOS —
// hardware-decoded, ~1/8th the H.264 size) → mp4 (H.264, universal last resort).
export function pickBgVideoSrc(v: HTMLVideoElement): string | undefined {
  const webm = v.dataset.src;
  // Probe the ACTUAL vp9/opus codec, not the bare "video/webm" container.
  // Safari/iOS answer non-empty ("maybe") for the bare container yet cannot
  // decode VP9 — the loose check handed them an undecodable source and the
  // backdrop went black. The codec-specific query returns "" on Safari/iOS, so
  // they correctly skip past the webm; Chrome/Firefox still get it. Chrome that
  // also has HEVC (v107+) never reaches the hevc branch — webm is checked first.
  if (webm && v.canPlayType('video/webm; codecs="vp9, opus"') !== "") return webm;
  // hvc1 = the Safari-required HEVC tag. Safari/iOS return "probably" here and
  // decode it in hardware; this is what spares them the heavy H.264 download.
  const hevc = v.dataset.srcHevc;
  if (hevc && v.canPlayType('video/mp4; codecs="hvc1"') !== "") return hevc;
  return v.dataset.srcMp4 || webm;
}
