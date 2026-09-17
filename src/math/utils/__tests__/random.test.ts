import { describe, expect, test } from 'vitest';

import {
  randomBool,
  randomColor,
  randomFloat,
  randomHash,
  randomInt,
  randomItem,
  randomObjItem,
  randomOdds,
  randomRange,
  randomShuffle,
  randomSign,
  randomSpread,
} from '~/math/utils/random';
import { seededRandom } from '~/math/utils/seededRandom';

/** Returns a function that yields the supplied values in order, then loops. */
function fixedSequence(values: number[]): () => number {
  let i = 0;

  return () => {
    const v = values[i % values.length];

    i++;

    return v;
  };
}

describe('randomColor', () => {
  test('returns a 24-bit integer color', () => {
    const color = randomColor(fixedSequence([0, 0, 0]));
    expect(color).toBe(0x000000);
  });

  test('floors 0.999999 to 0xfe per channel (Math.random never returns 1)', () => {
    const color = randomColor(fixedSequence([0.999999, 0.999999, 0.999999]));
    expect(color).toBe(0xfefefe);
  });

  test('packs r, g, b into the right bytes', () => {
    // r = 0.5 -> 127, g = 0.25 -> 63, b = 0.75 -> 191
    const color = randomColor(fixedSequence([0.5, 0.25, 0.75]));
    expect((color >> 16) & 0xff).toBe(Math.floor(0xff * 0.5));
    expect((color >> 8) & 0xff).toBe(Math.floor(0xff * 0.25));
    expect(color & 0xff).toBe(Math.floor(0xff * 0.75));
  });

  test('always falls within 0..0xffffff', () => {
    const random = seededRandom('color-seed');
    for (let i = 0; i < 50; i++) {
      const color = randomColor(random);
      expect(color).toBeGreaterThanOrEqual(0);
      expect(color).toBeLessThanOrEqual(0xffffff);
    }
  });
});

describe('randomRange', () => {
  test('returns min when random returns 0', () => {
    expect(randomRange(2, 10, false, fixedSequence([0]))).toBe(2);
  });

  test('returns just below max when random returns just under 1', () => {
    const result = randomRange(2, 10, false, fixedSequence([0.999999]));
    expect(result).toBeGreaterThanOrEqual(2);
    expect(result).toBeLessThan(10);
  });

  test('floors when floor flag is true', () => {
    expect(randomRange(2, 10, true, fixedSequence([0.55]))).toBe(Math.floor(2 + 0.55 * 8));
  });

  test('handles negative ranges', () => {
    expect(randomRange(-10, -2, false, fixedSequence([0.5]))).toBeCloseTo(-6, 5);
  });
});

describe('randomObjItem', () => {
  test('returns a value from the object', () => {
    const obj = { a: 1, b: 2, c: 3 };
    const result = randomObjItem(obj, fixedSequence([0]));
    // First key picked: a -> 1
    expect(result).toBe(1);
  });

  test('picks last key when random is just under 1', () => {
    const obj = { a: 1, b: 2, c: 3 };
    const result = randomObjItem(obj, fixedSequence([0.999999]));
    expect(result).toBe(3);
  });

  test('returned value is one of the object values', () => {
    const obj = { a: 1, b: 2, c: 3 };
    const random = seededRandom('obj-seed');
    for (let i = 0; i < 20; i++) {
      const result = randomObjItem(obj, random);
      expect([1, 2, 3]).toContain(result);
    }
  });
});

describe('randomItem', () => {
  test('returns first item when random returns 0', () => {
    expect(randomItem(['a', 'b', 'c'], fixedSequence([0]))).toBe('a');
  });

  test('returns last item when random returns just under 1', () => {
    expect(randomItem(['a', 'b', 'c'], fixedSequence([0.999999]))).toBe('c');
  });

  test('returns middle item appropriately', () => {
    expect(randomItem(['a', 'b', 'c'], fixedSequence([0.5]))).toBe('b');
  });

  test('returned item is always in the array', () => {
    const arr = [10, 20, 30, 40, 50];
    const random = seededRandom('item-seed');
    for (let i = 0; i < 20; i++) {
      expect(arr).toContain(randomItem(arr, random));
    }
  });
});

describe('randomFloat', () => {
  test('returns min when random returns 0', () => {
    expect(randomFloat(2, 10, fixedSequence([0]))).toBe(2);
  });

  test('returns close to max when random returns just under 1', () => {
    const result = randomFloat(2, 10, fixedSequence([0.999999]));
    expect(result).toBeGreaterThan(9.99);
    expect(result).toBeLessThan(10);
  });

  test('returns midpoint when random returns 0.5', () => {
    expect(randomFloat(0, 10, fixedSequence([0.5]))).toBeCloseTo(5, 5);
  });
});

describe('randomSpread', () => {
  test('returns range/2 when random returns 0', () => {
    expect(randomSpread(10, fixedSequence([0]))).toBeCloseTo(5, 5);
  });

  test('returns -range/2 when random returns 1', () => {
    expect(randomSpread(10, fixedSequence([1]))).toBeCloseTo(-5, 5);
  });

  test('returns 0 when random returns 0.5', () => {
    expect(randomSpread(10, fixedSequence([0.5]))).toBeCloseTo(0, 5);
  });

  test('result is within [-range/2, range/2]', () => {
    const random = seededRandom('spread-seed');
    for (let i = 0; i < 50; i++) {
      const result = randomSpread(10, random);
      expect(result).toBeGreaterThanOrEqual(-5);
      expect(result).toBeLessThanOrEqual(5);
    }
  });
});

describe('randomInt', () => {
  test('returns min when random returns 0', () => {
    expect(randomInt(2, 5, fixedSequence([0]))).toBe(2);
  });

  test('returns max when random returns just under 1', () => {
    expect(randomInt(2, 5, fixedSequence([0.999999]))).toBe(5);
  });

  test('result is always an integer in [min, max]', () => {
    const random = seededRandom('int-seed');
    for (let i = 0; i < 100; i++) {
      const result = randomInt(0, 9, random);
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(9);
    }
  });

  test('handles negative ranges', () => {
    const random = seededRandom('int-neg');
    for (let i = 0; i < 30; i++) {
      const result = randomInt(-5, 5, random);
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(-5);
      expect(result).toBeLessThanOrEqual(5);
    }
  });
});

describe('randomBool', () => {
  test('returns true when random < weight', () => {
    expect(randomBool(0.5, fixedSequence([0.4]))).toBe(true);
  });

  test('returns false when random >= weight', () => {
    expect(randomBool(0.5, fixedSequence([0.5]))).toBe(false);
    expect(randomBool(0.5, fixedSequence([0.6]))).toBe(false);
  });

  test('always true with weight 1 and random < 1', () => {
    expect(randomBool(1, fixedSequence([0.5]))).toBe(true);
    expect(randomBool(1, fixedSequence([0.999999]))).toBe(true);
  });

  test('always false with weight 0', () => {
    expect(randomBool(0, fixedSequence([0]))).toBe(false);
    expect(randomBool(0, fixedSequence([0.5]))).toBe(false);
  });

  test('default weight is 0.5', () => {
    expect(randomBool(undefined, fixedSequence([0.4]))).toBe(true);
    expect(randomBool(undefined, fixedSequence([0.5]))).toBe(false);
  });
});

describe('randomSign', () => {
  test('returns -1 when random returns 0', () => {
    expect(randomSign(fixedSequence([0]))).toBe(-1);
  });

  test('returns 1 when random returns just under 1', () => {
    expect(randomSign(fixedSequence([0.999999]))).toBe(1);
  });

  test('only returns -1 or 1', () => {
    const random = seededRandom('sign-seed');
    for (let i = 0; i < 50; i++) {
      const result = randomSign(random);
      expect([-1, 1]).toContain(result);
    }
  });
});

describe('randomShuffle', () => {
  test('returns the same array reference (in-place)', () => {
    const arr = [1, 2, 3, 4, 5];
    const result = randomShuffle(arr, fixedSequence([0.1, 0.2, 0.3, 0.4]));
    expect(result).toBe(arr);
  });

  test('preserves the same set of elements', () => {
    const arr = [1, 2, 3, 4, 5];
    const original = [...arr];
    randomShuffle(arr, seededRandom('shuffle-seed'));
    const numCmp = (a: number, b: number) => a - b;
    expect(arr.sort(numCmp)).toEqual(original.sort(numCmp));
  });

  test('does not modify length', () => {
    const arr = [1, 2, 3, 4, 5];
    randomShuffle(arr, seededRandom('shuffle-len'));
    expect(arr.length).toBe(5);
  });

  test('handles empty array', () => {
    const arr: number[] = [];
    expect(randomShuffle(arr, fixedSequence([0.5]))).toBe(arr);
    expect(arr.length).toBe(0);
  });

  test('handles single-element array', () => {
    const arr = [42];
    randomShuffle(arr, fixedSequence([0.5]));
    expect(arr).toEqual([42]);
  });
});

describe('randomHash', () => {
  test('returns a string of the requested length', () => {
    const hash = randomHash(8, seededRandom('hash-seed'));
    expect(typeof hash).toBe('string');
    expect(hash.length).toBe(8);
  });

  test('returns an empty string for length 0', () => {
    expect(randomHash(0, seededRandom('hash-empty'))).toBe('');
  });

  test('uses only alphanumeric characters', () => {
    const hash = randomHash(20, seededRandom('hash-chars'));
    expect(hash).toMatch(/^[A-Za-z0-9]+$/);
  });

  test('first char picks A when random returns 0', () => {
    const hash = randomHash(1, fixedSequence([0]));
    expect(hash).toBe('A');
  });

  test('produces deterministic output for the same seed', () => {
    const a = randomHash(10, seededRandom('same'));
    const b = randomHash(10, seededRandom('same'));
    expect(a).toBe(b);
  });
});

describe('randomOdds', () => {
  test('throws when odds list is empty', () => {
    expect(() => randomOdds([], fixedSequence([0.5]))).toThrow('[Random] Odds list provided is empty');
  });

  test('returns the only item when single entry', () => {
    expect(randomOdds([[5, 'only']], fixedSequence([0.5]))).toBe('only');
  });

  test('returns the highest-odds item across many trials', () => {
    const items: [number, string][] = [
      [1, 'rare'],
      [10, 'common'],
    ];
    let commonHits = 0;
    const random = seededRandom('odds-seed');
    for (let i = 0; i < 200; i++) {
      if (randomOdds(items, random) === 'common') commonHits++;
    }
    // Common should win the vast majority. Allow a generous margin.
    expect(commonHits).toBeGreaterThan(150);
  });

  test('returns the smaller-odds item when rand falls into its bucket', () => {
    // After sorting by odds ascending: [[1, "rare"], [10, "common"]].
    // Total amount = 11. rand = 0.5 -> 0.5 * 11 = 5.5 -> falls in "common".
    // To hit "rare", rand * 11 must be in [0, 1) -> use 0.05 -> 0.55, lands in "rare".
    const items: [number, string][] = [
      [1, 'rare'],
      [10, 'common'],
    ];
    expect(randomOdds(items, fixedSequence([0.05]))).toBe('rare');
  });

  test('only returns values from the input odds list', () => {
    const items: [number, string][] = [
      [1, 'a'],
      [2, 'b'],
      [3, 'c'],
    ];
    const random = seededRandom('odds-coverage');
    for (let i = 0; i < 50; i++) {
      const result = randomOdds(items, random);
      expect(['a', 'b', 'c']).toContain(result);
    }
  });
});
