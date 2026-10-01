import { describe, expect, test } from 'vitest';

import { clamp } from '~/math/utils/clamp';

describe('clamp', () => {
  test('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  test('clamps to min when value is below range', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  test('clamps to max when value is above range', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  test('returns min when value equals min', () => {
    expect(clamp(0, 0, 10)).toBe(0);
  });

  test('returns max when value equals max', () => {
    expect(clamp(10, 0, 10)).toBe(10);
  });

  test('handles min equal to max', () => {
    expect(clamp(5, 3, 3)).toBe(3);
    expect(clamp(1, 3, 3)).toBe(3);
  });

  test('handles Infinity and -Infinity', () => {
    expect(clamp(Infinity, 0, 10)).toBe(10);
    expect(clamp(-Infinity, 0, 10)).toBe(0);
    expect(clamp(5, -Infinity, Infinity)).toBe(5);
  });

  test('returns NaN when value is NaN', () => {
    expect(Number.isNaN(clamp(NaN, 0, 10))).toBe(true);
  });
});
