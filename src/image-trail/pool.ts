// The thumbnail reuse pool for the image-trail. ImageTrailInstance wraps
// the `.image-wrap` mount: it holds every `.content__img` as a cyclic pool
// (`images`, indexed by `imgPosition`), tracks the subset currently ON SCREEN
// (`active`, oldest → newest), and spawns the next thumb at the cursor on each
// reveal — the instant spawn + [SIZE] tier cycle. The dismissal cascade reads
// `active` to clear only what's visible; see dismissal.ts.
//
// Copied verbatim from vshslv.com src/scripts/home/image-trail/pool.ts (only
// the import paths changed).

import { gsap } from "gsap";
import { isSafari } from "../shared/device-detection.ts";
import { playSfx } from "../shared/sfx.ts";
import type { Point } from "./config.ts";
import {
  FOLD_PERSPECTIVE,
  SPAWN_DUR,
  SPAWN_EASE,
  SPAWN_INSTANT,
  SPAWN_POP,
  SPAWN_RISE,
  TEAR_CHANCE,
  TEAR_RUN_MAX,
  TEAR_RUN_MIN,
  TRAIL_SIZE_TIERS,
} from "./config.ts";

export class ImageEl {
  DOM: { el: HTMLElement; inner: HTMLElement | null };
  rect: DOMRect;

  constructor(el: HTMLElement) {
    this.DOM = {
      el,
      inner: el.querySelector(".content__img-inner"),
    };
    this.rect = this.DOM.el.getBoundingClientRect();
  }
}

export class ImageTrailInstance {
  DOM: { el: HTMLElement };
  images: ImageEl[];
  imagesTotal: number;
  imgPosition = 0;
  zIndexVal = 1;
  // The thumbs currently ON SCREEN, oldest → newest. The reuse pool (`images`)
  // is mostly invisible at any moment; this is the subset a clear actually has
  // to dismiss, so the dismissal cascade stays bounded by what's visible.
  active: ImageEl[] = [];
  // [TEAR] Remaining spawns to SKIP in the current gap run (see showNextImage).
  gapLeft = 0;

  constructor(DOM_el: HTMLElement) {
    this.DOM = { el: DOM_el };
    this.images = Array.from(
      this.DOM.el.querySelectorAll<HTMLElement>(".content__img")
    ).map((img) => new ImageEl(img));
    this.imagesTotal = this.images.length;
  }

  showNextImage(position: Point): void {
    // [TEAR] Occasionally drop a short run of spawns so the stroke shows
    // gaps/breaks — a glitchy, dropped-signal feel. Never before the trail is
    // established (active.length 0) so the FIRST thumb always shows (the host
    // copy collapse is gated on a thumb appearing). The cursor still advances in
    // input.ts, so the next real thumb lands a gap further along.
    if (this.active.length > 0) {
      if (this.gapLeft > 0) {
        this.gapLeft--;
        return;
      }
      if (Math.random() < TEAR_CHANCE) {
        const run =
          TEAR_RUN_MIN +
          Math.floor(Math.random() * (TEAR_RUN_MAX - TEAR_RUN_MIN + 1));
        this.gapLeft = run - 1; // this call is the first skip of the run
        return;
      }
    }

    ++this.zIndexVal;
    this.imgPosition =
      this.imgPosition < this.imagesTotal - 1 ? this.imgPosition + 1 : 0;
    const img = this.images[this.imgPosition];

    playHoverClick();

    // Track as on-screen, newest-last. If this pool slot was still shown (being
    // recycled), move it to the end rather than duplicating it.
    const wasActive = this.active.indexOf(img);
    if (wasActive !== -1) this.active.splice(wasActive, 1);
    this.active.push(img);

    // [SIZE] Per-spawn target size = the next DISCRETE tier in the modular cycle
    // (TRAIL_SIZE_TIERS), indexed by the spawn counter (zIndexVal increments once
    // per real spawn — a torn/skipped spawn doesn't advance it, so the rhythm is
    // stable). A multiplier on the CSS --trail-unit; max tier is 1.0, so no thumb
    // exceeds the unit. Scale is applied about the element centre, so the thumb
    // stays centred on the cursor regardless of its size.
    const target = TRAIL_SIZE_TIERS[this.zIndexVal % TRAIL_SIZE_TIERS.length];

    gsap.killTweensOf(img.DOM.el);

    if (SPAWN_INSTANT) {
      // [SPAWN: instant] No easing, no fade, no scale-up, no rise — the thumb is
      // just THERE, at full opacity and its target size, the instant it's
      // detected. `scale` sets BOTH axes, clearing any non-uniform
      // scaleX/scaleY a prior "scan" dismissal left on this reused pool slot;
      // rotationY/filter reset clear a prior fold/blur. All "smoothness" gone —
      // the rhythm is the random dismissal + tear, not entrance motion.
      gsap.set(img.DOM.el, {
        opacity: 1,
        scale: target,
        transformPerspective: FOLD_PERSPECTIVE,
        rotationY: 0,
        filter: "blur(0px)",
        zIndex: this.zIndexVal,
        x: Math.round(position.x - img.rect.width / 2),
        y: Math.round(position.y - img.rect.height / 2),
      });
      return;
    }

    // [SPAWN: eased] A/B fallback — fade in (opacity 0 → 1) with a light
    // scale-up + rise on an easeOut. Disabled by default (SPAWN_INSTANT).
    gsap.set(img.DOM.el, {
      opacity: 0,
      scale: target * SPAWN_POP,
      transformPerspective: FOLD_PERSPECTIVE,
      rotationY: 0,
      filter: "blur(0px)",
      zIndex: this.zIndexVal,
      x: Math.round(position.x - img.rect.width / 2),
      y: Math.round(position.y - img.rect.height / 2 + SPAWN_RISE),
    });

    gsap.to(img.DOM.el, {
      opacity: 1,
      scale: target,
      y: `-=${SPAWN_RISE}`,
      duration: SPAWN_DUR,
      ease: SPAWN_EASE,
    });
  }
}

// Per-spawn click through the Web Audio engine (shared/sfx.ts — one decoded
// buffer per clip, throwaway source nodes, one master gain). A cloned-<audio>
// approach spins up a full media-element pipeline per spawn — fine at a 200px
// trail threshold, audibly hitching at 90px. Safari stays muted because rapid
// autoplays sound jarring on its pipeline.
function playHoverClick(): void {
  if (isSafari()) return;
  playSfx("/sounds/hover.mp3");
}
