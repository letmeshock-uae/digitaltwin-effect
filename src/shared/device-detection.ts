// Browser / input-capability detection. Copied verbatim from vshslv.com
// src/scripts/shared/device-detection.ts (minus the helpers the trail
// doesn't use).

/** Desktop Safari and iOS Safari only — excludes Chrome / Edge / CriOS,
 *  which also carry "safari" in their UA string. Used to gate the
 *  image-trail hover sound (Safari blocks un-gestured Audio.play). */
export const isSafari = (): boolean => {
  const ua = navigator.userAgent.toLowerCase();
  return (
    ua.includes("safari") &&
    !ua.includes("chrome") &&
    !ua.includes("crios") &&
    !ua.includes("edg")
  );
};

/** True when the device reports any touch input. */
export const isTouchDevice = (): boolean =>
  "ontouchstart" in window ||
  navigator.maxTouchPoints > 0 ||
  (navigator as unknown as { msMaxTouchPoints?: number }).msMaxTouchPoints! > 0;

/** True when the user asked the OS to minimize non-essential motion.
 *  Gates every GSAP intro/spin/morph. Resolved per-call. */
export const prefersReducedMotion = (): boolean =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;
