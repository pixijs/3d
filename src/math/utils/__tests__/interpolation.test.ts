import { describe, expect, test } from 'vitest';

import { damp, inverseLerp, lerp, mapLinear } from '~/math/utils/interpolation';

describe('lerp', () => {
  test('returns x when t is 0', () => {
    expect(lerp(2, 10, 0)).toBe(2);
  });

  test('returns y when t is 1', () => {
    expect(lerp(2, 10, 1)).toBe(10);
  });

  test('returns midpoint when t is 0.5', () => {
    expect(lerp(0, 10, 0.5)).toBeCloseTo(5, 5);
    expect(lerp(2, 10, 0.5)).toBeCloseTo(6, 5);
  });

  test('extrapolates beyond [0, 1]', () => {
    expect(lerp(0, 10, 2)).toBeCloseTo(20, 5);
    expect(lerp(0, 10, -1)).toBeCloseTo(-10, 5);
  });

  test('handles negative ranges', () => {
    expect(lerp(-10, 10, 0.5)).toBeCloseTo(0, 5);
    expect(lerp(-5, -1, 0.25)).toBeCloseTo(-4, 5);
  });

  test('returns same value when x equals y', () => {
    expect(lerp(7, 7, 0)).toBe(7);
    expect(lerp(7, 7, 0.5)).toBe(7);
    expect(lerp(7, 7, 1)).toBe(7);
  });
});

describe('inverseLerp', () => {
  test('returns 0 when value equals x', () => {
    expect(inverseLerp(2, 10, 2)).toBe(0);
  });

  test('returns 1 when value equals y', () => {
    expect(inverseLerp(2, 10, 10)).toBe(1);
  });

  test('returns 0.5 at the midpoint', () => {
    expect(inverseLerp(0, 10, 5)).toBeCloseTo(0.5, 5);
  });

  test('extrapolates beyond [0, 1]', () => {
    expect(inverseLerp(0, 10, 20)).toBeCloseTo(2, 5);
    expect(inverseLerp(0, 10, -10)).toBeCloseTo(-1, 5);
  });

  test('returns 0 when x equals y to avoid division by zero', () => {
    expect(inverseLerp(5, 5, 5)).toBe(0);
    expect(inverseLerp(5, 5, 10)).toBe(0);
  });

  test('round-trips through lerp', () => {
    const x = -3;
    const y = 7;
    const t = 0.42;
    const value = lerp(x, y, t);
    expect(inverseLerp(x, y, value)).toBeCloseTo(t, 5);
  });
});

describe('mapLinear', () => {
  test('maps from one range to another', () => {
    expect(mapLinear(5, 0, 10, 0, 100)).toBeCloseTo(50, 5);
    expect(mapLinear(0, 0, 10, 0, 100)).toBeCloseTo(0, 5);
    expect(mapLinear(10, 0, 10, 0, 100)).toBeCloseTo(100, 5);
  });

  test('handles inverted target range', () => {
    expect(mapLinear(0, 0, 10, 100, 0)).toBeCloseTo(100, 5);
    expect(mapLinear(10, 0, 10, 100, 0)).toBeCloseTo(0, 5);
    expect(mapLinear(5, 0, 10, 100, 0)).toBeCloseTo(50, 5);
  });

  test('maps to negative target range', () => {
    expect(mapLinear(0.5, 0, 1, -1, 1)).toBeCloseTo(0, 5);
    expect(mapLinear(0, 0, 1, -1, 1)).toBeCloseTo(-1, 5);
    expect(mapLinear(1, 0, 1, -1, 1)).toBeCloseTo(1, 5);
  });

  test('extrapolates beyond source range', () => {
    expect(mapLinear(20, 0, 10, 0, 100)).toBeCloseTo(200, 5);
    expect(mapLinear(-10, 0, 10, 0, 100)).toBeCloseTo(-100, 5);
  });
});

describe('damp', () => {
  test('returns x when dt is 0 (no time passed)', () => {
    expect(damp(0, 10, 5, 0)).toBeCloseTo(0, 5);
  });

  test('approaches y as dt grows', () => {
    expect(damp(0, 10, 5, 100)).toBeCloseTo(10, 5);
  });

  test('returns x when lambda is 0 (no damping)', () => {
    expect(damp(0, 10, 0, 1)).toBeCloseTo(0, 5);
  });

  test('produces a value between x and y for finite parameters', () => {
    const result = damp(0, 10, 1, 0.5);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(10);
  });

  test('matches lerp(x, y, 1 - exp(-lambda * dt))', () => {
    const x = 2;
    const y = 8;
    const lambda = 3;
    const dt = 0.25;
    const expected = lerp(x, y, 1 - Math.exp(-lambda * dt));
    expect(damp(x, y, lambda, dt)).toBeCloseTo(expected, 5);
  });
});
