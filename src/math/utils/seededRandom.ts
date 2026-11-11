/**
 * Creates a random function that returns the same sequence of numbers in `[0, 1)` for the same seed
 *
 * Use it wherever `Math.random` would go when results must repeat, such as a level generated from a
 * shared seed or a replay. It runs mulberry32, seeded by hashing the string with xmur3, and isn't
 * safe for cryptography.
 * @see https://stackoverflow.com/a/47593316
 * @example
 * ```ts
 * const random = seededRandom(`level-${levelNumber}`);
 *
 * for (const slot of treeSlots) {
 *   if (random() < 0.3) plantTree(slot, 0.8 + random() * 0.4);
 * }
 * ```
 * @param seed - Any string; the same string always gives the same sequence
 * @returns Function that can be used in place of `Math.random`
 * @category maths
 * @standard
 */
export function seededRandom(seed: string): () => number {
  return mulberry32(xmur3(seed)());
}

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;

  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }

  return (): number => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);

    return (h ^= h >>> 16) >>> 0;
  };
}

/** The state sits in an `Int32Array`, not a closure variable, because draws measured faster that way */
function mulberry32(seed: number): () => number {
  const state = new Int32Array(1);

  state[0] = seed;

  return (): number => {
    const a = (state[0] = (state[0] + 0x6d2b79f5) | 0);
    let t = Math.imul(a ^ (a >>> 15), a | 1);

    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
