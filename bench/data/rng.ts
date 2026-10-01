/**
 * The scenes' random numbers: the vectors and ranges a scene is laid out from, over one mulberry32 stream.
 *
 * A scene has to be the same scene on every machine and in every run, or two arms are two workloads.
 * `Math.random` is not: the JavaScript engine seeds it. Changing this stream changes every scene, and a bench's
 * earlier results no longer describe it.
 */

export interface Rng {
  next(): number;
  range(min: number, max: number): number;
  int(maxExclusive: number): number;
  /** A uniform random unit vector, written into `out`. */
  unit(out: Float32Array | number[], at?: number): void;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b_79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function rng(seed: number): Rng {
  const next = mulberry32(seed);
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    unit(out, at = 0) {
      const z = next() * 2 - 1;
      const phi = next() * Math.PI * 2;
      const radius = Math.sqrt(1 - z * z);
      out[at] = radius * Math.cos(phi);
      out[at + 1] = radius * Math.sin(phi);
      out[at + 2] = z;
    },
  };
}
