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
    const color = randomColor(fixedSequence([0.5, 0.25, 0.75]));
    expect((color >> 16) & 0xff).toBe(Math.floor(0xff * 0.5));
    expect((color >> 8) & 0xff).toBe(Math.floor(0xff * 0.25));
    expect(color & 0xff).toBe(Math.floor(0xff * 0.75));
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
  test('picks the first key when random returns 0', () => {
    const obj = { a: 1, b: 2, c: 3 };
    const result = randomObjItem(obj, fixedSequence([0]));
    expect(result).toBe(1);
  });

  test('picks last key when random is just under 1', () => {
    const obj = { a: 1, b: 2, c: 3 };
    const result = randomObjItem(obj, fixedSequence([0.999999]));
    expect(result).toBe(3);
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
});

describe('randomInt', () => {
  test('returns min when random returns 0', () => {
    expect(randomInt(2, 5, fixedSequence([0]))).toBe(2);
  });

  test('returns max when random returns just under 1', () => {
    expect(randomInt(2, 5, fixedSequence([0.999999]))).toBe(5);
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
});

describe('randomShuffle', () => {
  test('preserves the same set of elements', () => {
    const arr = [1, 2, 3, 4, 5];
    const original = [...arr];
    randomShuffle(arr, seededRandom('shuffle-seed'));
    const numCmp = (a: number, b: number) => a - b;
    expect(arr.sort(numCmp)).toEqual(original.sort(numCmp));
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
});

describe('randomOdds', () => {
  test('throws when odds list is empty', () => {
    expect(() => randomOdds([], fixedSequence([0.5]))).toThrow('[Random] Odds list provided is empty');
  });

  test('returns the only item when single entry', () => {
    expect(randomOdds([[5, 'only']], fixedSequence([0.5]))).toBe('only');
  });

  test('returns the highest-odds item in more than 150 of 200 trials', () => {
    const items: [number, string][] = [
      [1, 'rare'],
      [10, 'common'],
    ];
    let commonHits = 0;
    const random = seededRandom('odds-seed');
    for (let i = 0; i < 200; i++) {
      if (randomOdds(items, random) === 'common') commonHits++;
    }
    expect(commonHits).toBeGreaterThan(150);
  });

  test('returns the smaller-odds item when the roll lands in its share of the total odds', () => {
    const items: [number, string][] = [
      [1, 'rare'],
      [10, 'common'],
    ];
    const rollInsideRareShare = 0.05;
    expect(randomOdds(items, fixedSequence([rollInsideRareShare]))).toBe('rare');
  });
});
