// [CODE-WINDOWS] Shared noise helpers for the torn window rims
// (image-trail/mask-layer.ts). ONE JS source of truth — extracted so a second
// consumer can't fork its own drifting copy.

// Deterministic 0..1 hash — imul mix + an AVALANCHE finish. The finish is
// load-bearing: the raw XOR-of-products is bitwise-linear per axis, so its low
// bits alone form a periodic banding motif (measured in review), not noise.
export function h01(a: number, b: number, c: number): number {
  let x = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2246822519);
  x = Math.imul(x ^ (x >>> 15), 2654435761);
  x ^= x >>> 13;
  return ((x >>> 0) & 0xfffff) / 0x100000;
}

// Smooth 3D value noise on the h01 lattice (trilinear, smoothstep fade) — one
// octave; callers layer two for richer shapes. TIME rides the z axis so a
// field EVOLVES IN PLACE — a translated 2D field reads as the whole mass
// sliding sideways (owner flagged that on an earlier iteration).
export function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const slice = (zz: number): number => {
    const a = h01(xi, yi, zz);
    const b = h01(xi + 1, yi, zz);
    const c = h01(xi, yi + 1, zz);
    const d = h01(xi + 1, yi + 1, zz);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const n0 = slice(zi);
  return n0 + (slice(zi + 1) - n0) * w;
}
