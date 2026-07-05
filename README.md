# image-trail-lab

Standalone sandbox for the vshslv.com image-trail cursor effect — extracted for
reworking toward another site. Vite + vanilla TypeScript + GSAP, no framework.

## Run

```sh
pnpm install
pnpm dev      # http://localhost:5173
pnpm build    # tsc --noEmit + vite build → dist/
```

Deploys to Vercel with zero config (framework preset: Vite).

## Experiments

Variants live on numeric paths — the same `index.html` serves them all (Vite's
SPA fallback in dev, the `vercel.json` rewrite in prod). The router is the
`EXPERIMENT` switch in `src/main.ts`:

- **`/`** — the full lab: intro develop → clean video + the image trail.
- **`/2`** (and any unlisted number) — the ascii field **held**: the develop
  runs black → glyphs and freezes there (the `trail-hero` engaged state) — the
  whole backdrop stays the ramp-ascii render, cursor lens live. No trail.
- **`/3`** — **split screen**: left half the clean video, right half the held
  ascii field. The split happens in-renderer (a step-4 clean-frame draw on the
  2D path, a `uSplit` uniform on the WebGL path), so both halves share one
  cover crop and one frame — the seam is frame-exact on both engines. No trail.
- **`/4`** — `/2` with the Kling particle-dune clip (`media/kling.mp4`,
  1080p re-encode of the 4K original). The clip is dark (avg luma ≈ 0.11), so
  the experiment overrides the contrast curve (`blackPoint`/`whitePoint`
  mount opts) with the proven dark-clip pair from the mask windows' `WIN_*`.
- **`/5`** — `/3` (split) with the Kling clip + the same contrast override.

Adding one: drop a spec into the `EXPERIMENTS` table in `src/main.ts` (clip
swap, split fraction, contrast points) — the rewrite already catches any
number.

## What this is

The full trail core from `vshslv.com/src/scripts/home/image-trail{,.ts}` as of
2026-07-02, kept intact:

- **`src/image-trail/config.ts`** — every feel knob with its rationale: spawn
  style (`SPAWN_INSTANT` "detection box" vs eased A/B fallback), the five
  dismissal styles (`DISMISS_STYLE`: snap / scan / pop / fold / blur), the
  [TEAR] gap runs, the discrete `TRAIL_SIZE_TIERS` modular scale, reveal
  distances.
- **`src/image-trail/pool.ts`** — the cyclic thumbnail reuse pool + instant
  spawn (verbatim).
- **`src/image-trail/input.ts`** — mouse + touch handlers: threshold reveal,
  idle clear scheduling, the lone-card "showcase" hold, the bottom-half touch
  control surface (verbatim minus the overlay gate, see below).
- **`src/image-trail/dismissal.ts`** — the per-thumb clear + the chaotic
  random-delay burst cascade.
- **`src/image-trail/toggle.ts`** — the on/off state machine (generation bump,
  isToggling latch, deferred reveal, clean-slate pool snap).
- **`src/shared/sfx.ts`** — the Web Audio SFX engine + `hover.mp3` per spawn
  (verbatim; Safari muted).
- **`src/image-trail/mask-layer.ts`** — [CODE-WINDOWS] the card painter: the
  trail cards are WINDOWS OF CODE — each visible card renders the slice of the
  hidden `mask.mp4` under its own screen rect AS the ramp ASCII (the verbatim
  pipeline: luminance chooses the glyph, the clip pours into the glyph shapes,
  gaps black — through the windows' own `WIN_*` contrast curve, the clip is
  dark), clipped to the card's TORN shape (rim-noise eats up to `TORN_DEPTH`
  cells inward, evolving in place). Telemetry ticker rows surface inside the
  windows. The grid is viewport-fixed (cards reveal one fixed underlying code
  field). One hidden video + one offscreen compose + one canvas; a gsap.ticker
  pass at `TARGET_FPS` reads every pool box's live transform
  (x/y/scaleX/scaleY/opacity, no layout reads). The trail engine is untouched
  — the `.content__img` boxes are
  empty geometry proxies. Noise helpers shared via `src/ascii/field-noise.ts`.
- **`src/ascii/`** — the hero backdrop, BOTH renderers: the 2D-canvas
  crossfade mode for Chromium/Firefox (`ascii-video.ts`) and the WebGL2
  sole-canvas fork for ANY WebKit (`ascii-video-webgl.ts` — Safari desktop +
  iOS promote a playing inline `<video>` to a hardware overlay that occludes a
  canvas sibling, WebKit bug 29314, so there the canvas is the only visible
  layer and samples a hidden video as a GPU texture). Shared look constants in
  `ascii-constants.ts`, source ladder in `bg-video.ts` — verbatim, including
  the Bourke density ramp. In THIS iteration the backdrop only ever paints the
  one-shot intro "develop" (black → glyphs → video) — the steady-state code
  lives ONLY in the trail's torn windows (owner's call), so main.ts no longer
  dispatches `trail-hero` and the field never engages full-screen. The
  modules stay intact (listeners simply never fire) for an easy re-enable.
  (Earlier full-field iterations — data-stream, torn blocks, peripheral
  spots — live in git history, `2fa8703`…`b5e8e28`.)
- **`src/style.css`** — the `--trail-unit` sizing system + breakpoint steps,
  and `.hero-video`/`.hero-ascii` from `links.css`.

## Deltas from the original (documented on purpose)

- **Host reaction → hooks.** The hero-copy char-by-char typewriter
  (`hero-copy.ts`) became the `TrailHooks` pair — `onEngage`/`onDisengage`
  (context.ts). The sandbox demo hides `.demo-copy` with a plain CSS opacity
  fade as a *placeholder*; wire the target site's real reaction there.
- **`isOverlayUp()` removed** (vshslv.com's modal/terminal gate). If the target
  site grows an overlay that owns the screen, reintroduce the gate in
  `input.ts` (spawn guards) and `dismissal.ts` (`revealHero`).
- **Toggle chrome dropped.** The bg-video promote/pause + curtain-blur reveal
  and the toggle-knob animation were vshslv.com hero furniture. The body class
  is now `trail-off`, the event `trail-toggled`. The state machine itself is
  unchanged.
- **Cards carry no images.** The original per-card `<img>` pipeline
  (`ImageTrail.astro`, astro:assets) is gone — the pool builds EMPTY
  `.content__img` boxes (`src/data.ts` keeps the original orientation
  sequence, `POOL_REPEAT = 2` kept) and [CODE-WINDOWS] paints them as torn
  ascii windows onto `public/media/mask.mp4`. The backdrop clip is
  `public/media/background.mp4` and stays clean video after the intro — the
  hooks in `main.ts` no longer dispatch `trail-hero`.
- **No loader gate.** vshslv.com holds the ASCII intro "develop" until its
  loader bar completes (`onLoaderFinished`); the sandbox has no loader, so the
  develop kicks as soon as the first frame decodes.

## Origin

Extracted from the private repo `vshslv/vshslv.com`. When a tuning insight
lands here that should flow back, the file-level comments map 1:1 to the
originals.
