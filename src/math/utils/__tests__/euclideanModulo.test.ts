import { describe, expect, test } from 'vitest';

import { euclideanModulo, pingpong } from '~/math/utils/euclideanModulo';

describe('euclideanModulo', () => {
  test('returns positive remainder for positive inputs', () => {
    expect(euclideanModulo(7, 3)).toBe(1);
    expect(euclideanModulo(10, 4)).toBe(2);
  });

  test('returns positive remainder for negative inputs', () => {
    expect(euclideanModulo(-1, 5)).toBe(4);
    expect(euclideanModulo(-7, 3)).toBe(2);
  });

  test('returns 0 when n is a multiple of m', () => {
    expect(euclideanModulo(0, 5)).toBe(0);
    expect(euclideanModulo(10, 5)).toBe(0);
    expect(euclideanModulo(-10, 5)).toBe(0);
  });

  test('handles fractional values', () => {
    expect(euclideanModulo(2.5, 1)).toBeCloseTo(0.5, 5);
    expect(euclideanModulo(-0.25, 1)).toBeCloseTo(0.75, 5);
  });
});

describe('pingpong', () => {
  test('uses default length of 1', () => {
    expect(pingpong(0)).toBeCloseTo(0, 5);
    expect(pingpong(0.5)).toBeCloseTo(0.5, 5);
    expect(pingpong(1)).toBeCloseTo(1, 5);
    expect(pingpong(1.5)).toBeCloseTo(0.5, 5);
    expect(pingpong(2)).toBeCloseTo(0, 5);
  });

  test('produces a triangle wave for arbitrary length', () => {
    expect(pingpong(0, 5)).toBeCloseTo(0, 5);
    expect(pingpong(2.5, 5)).toBeCloseTo(2.5, 5);
    expect(pingpong(5, 5)).toBeCloseTo(5, 5);
    expect(pingpong(7.5, 5)).toBeCloseTo(2.5, 5);
    expect(pingpong(10, 5)).toBeCloseTo(0, 5);
  });

  test('handles negative inputs', () => {
    expect(pingpong(-0.5, 1)).toBeCloseTo(0.5, 5);
    expect(pingpong(-1, 1)).toBeCloseTo(1, 5);
    expect(pingpong(-1.5, 1)).toBeCloseTo(0.5, 5);
  });
});
