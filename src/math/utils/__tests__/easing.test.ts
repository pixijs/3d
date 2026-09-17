import { describe, expect, test } from 'vitest';

import { smootherstep, smoothstep } from '~/math/utils/easing';

describe('smoothstep', () => {
  test('returns 0 when x is at or below min', () => {
    expect(smoothstep(0, 0, 1)).toBe(0);
    expect(smoothstep(-1, 0, 1)).toBe(0);
  });

  test('returns 1 when x is at or above max', () => {
    expect(smoothstep(1, 0, 1)).toBe(1);
    expect(smoothstep(2, 0, 1)).toBe(1);
  });

  test('returns 0.5 at the midpoint', () => {
    expect(smoothstep(0.5, 0, 1)).toBeCloseTo(0.5, 5);
  });

  test('matches the Hermite polynomial 3t^2 - 2t^3', () => {
    // For x in [0, 1] with min=0 and max=1, the polynomial is x*x*(3-2*x).
    expect(smoothstep(0.25, 0, 1)).toBeCloseTo(0.25 * 0.25 * (3 - 2 * 0.25), 5);
    expect(smoothstep(0.75, 0, 1)).toBeCloseTo(0.75 * 0.75 * (3 - 2 * 0.75), 5);
  });

  test('is monotonically increasing across the range', () => {
    let prev = smoothstep(0, 0, 1);
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      const v = smoothstep(t, 0, 1);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  test('rescales between arbitrary min and max', () => {
    expect(smoothstep(5, 0, 10)).toBeCloseTo(0.5, 5);
    expect(smoothstep(0, 0, 10)).toBe(0);
    expect(smoothstep(10, 0, 10)).toBe(1);
  });

  test('handles negative ranges', () => {
    expect(smoothstep(-5, -10, 0)).toBeCloseTo(0.5, 5);
    expect(smoothstep(-10, -10, 0)).toBe(0);
    expect(smoothstep(0, -10, 0)).toBe(1);
  });
});

describe('smootherstep', () => {
  test('returns 0 when x is at or below min', () => {
    expect(smootherstep(0, 0, 1)).toBe(0);
    expect(smootherstep(-1, 0, 1)).toBe(0);
  });

  test('returns 1 when x is at or above max', () => {
    expect(smootherstep(1, 0, 1)).toBe(1);
    expect(smootherstep(2, 0, 1)).toBe(1);
  });

  test('returns 0.5 at the midpoint', () => {
    expect(smootherstep(0.5, 0, 1)).toBeCloseTo(0.5, 5);
  });

  test('matches the polynomial 6t^5 - 15t^4 + 10t^3', () => {
    const x = 0.3;
    const expected = x * x * x * (x * (x * 6 - 15) + 10);
    expect(smootherstep(x, 0, 1)).toBeCloseTo(expected, 5);
  });

  test('is monotonically increasing across the range', () => {
    let prev = smootherstep(0, 0, 1);
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      const v = smootherstep(t, 0, 1);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  test('rescales between arbitrary min and max', () => {
    expect(smootherstep(5, 0, 10)).toBeCloseTo(0.5, 5);
    expect(smootherstep(0, 0, 10)).toBe(0);
    expect(smootherstep(10, 0, 10)).toBe(1);
  });
});
