/**
 * Creates a seeded random function similar to `Math.random()` based on the given seed hash
 * @param seed - The hash string, can be anything
 * @returns Function that can be used in place of `Math.random`
 * @category maths
 * @standard
 */
export function seededRandom(seed: string): () => number {
  // mulberry32 PRNG seeded via the xmur3 string hash: https://stackoverflow.com/a/47593316
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

function mulberry32(a: number): () => number {
  return (): number => {
    let t = (a += 0x6d2b79f5);

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
