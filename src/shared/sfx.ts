// UI sound effects on Web Audio — copied verbatim from vshslv.com
// src/scripts/shared/sfx.ts: a lazily-created AudioContext, a single master
// GainNode, and a per-file decoded-AudioBuffer cache. Each playSfx() spawns
// a throwaway AudioBufferSourceNode (the audio engine's cheap fire-and-forget
// voice, auto-released when its clip ends), so even rapid-fire callers like
// the image trail never allocate a media-element pipeline the way a per-play
// `new Audio()` / cloneNode approach would. Overlapping playbacks mix
// naturally instead of cutting each other off.
//
// SFX_GAIN is the one shared loudness for every effect. Clips should be
// mastered to ~-40dB mean (hover.mp3 is) rather than trimmed here per-call.
//
// Everything is lazy: no context, no fetch until a surface first asks for a
// sound. If the browser gates audio behind a user gesture the context starts
// suspended — every play retries resume(), which sticks after the first real
// click/tap anywhere.
const SFX_GAIN = 0.3;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
// null = fetch/decode in flight (or failed) — plays no-op rather than queue.
const buffers = new Map<string, AudioBuffer | null>();

export function playSfx(src: string): void {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = SFX_GAIN;
    master.connect(ctx.destination);
  }
  if (!buffers.has(src)) {
    buffers.set(src, null);
    fetch(src)
      .then((r) => r.arrayBuffer())
      .then((ab) => ctx!.decodeAudioData(ab))
      .then((buf) => {
        buffers.set(src, buf);
      })
      .catch(() => {});
  }
  const buf = buffers.get(src);
  if (!buf) return;
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
    return;
  }
  const source = ctx.createBufferSource();
  source.buffer = buf;
  source.connect(master!);
  source.start();
}
