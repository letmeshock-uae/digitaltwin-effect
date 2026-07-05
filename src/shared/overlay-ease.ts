// The shared overlay-open motion — extracted from vshslv.com
// src/scripts/shared/overlay-flip.ts (the ease/duration subset; the FLIP rect
// math stayed behind — the lab has no overlays to fly). OPEN_EASE is the
// site's micro-pausing curve: note the flat 0.5→0.5 hold from 26%→65% of the
// timeline (a beat mid-motion). The CustomEase path is piecewise linear (`L`
// segments), identical to the CSS `linear()` form of the same curve. The
// loader bar sweeps with it over OPEN_S — the exact curve + duration every
// vshslv.com overlay opens with.

import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";

gsap.registerPlugin(CustomEase);

export const OPEN_EASE = CustomEase.create(
  "overlayOpen",
  "M0,0 L0.06,0.18 L0.13,0.36 L0.22,0.48 L0.26,0.5 L0.65,0.5 L0.7,0.55 L0.77,0.65 L0.84,0.77 L0.89,0.86 L0.93,0.93 L0.97,0.97 L1,1"
);
export const OPEN_S = 1;
