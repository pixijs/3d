import { describe, expect, test } from 'vitest';

import { denormalize, normalize } from '~/math/utils/normalize';

describe('normalize', () => {
  test('returns the value unchanged for Float32Array', () => {
    const arr = new Float32Array(1);
    expect(normalize(0.5, arr)).toBe(0.5);
    expect(normalize(-0.5, arr)).toBe(-0.5);
    expect(normalize(0, arr)).toBe(0);
    expect(normalize(1, arr)).toBe(1);
  });

  test('scales to Uint32 range', () => {
    const arr = new Uint32Array(1);
    expect(normalize(0, arr)).toBe(0);
    expect(normalize(1, arr)).toBe(4294967295);
    expect(normalize(0.5, arr)).toBe(Math.round(0.5 * 4294967295));
  });

  test('scales to Uint16 range', () => {
    const arr = new Uint16Array(1);
    expect(normalize(0, arr)).toBe(0);
    expect(normalize(1, arr)).toBe(65535);
    expect(normalize(0.5, arr)).toBe(Math.round(0.5 * 65535));
  });

  test('scales to Uint8 range', () => {
    const arr = new Uint8Array(1);
    expect(normalize(0, arr)).toBe(0);
    expect(normalize(1, arr)).toBe(255);
    expect(normalize(0.5, arr)).toBe(128);
  });

  test('scales to Int32 range', () => {
    const arr = new Int32Array(1);
    expect(normalize(0, arr)).toBe(0);
    expect(normalize(1, arr)).toBe(2147483647);
    expect(normalize(-1, arr)).toBe(-2147483647);
  });

  test('scales to Int16 range', () => {
    const arr = new Int16Array(1);
    expect(normalize(0, arr)).toBe(0);
    expect(normalize(1, arr)).toBe(32767);
    expect(normalize(-1, arr)).toBe(-32767);
  });

  test('scales to Int8 range', () => {
    const arr = new Int8Array(1);
    expect(normalize(0, arr)).toBe(0);
    expect(normalize(1, arr)).toBe(127);
    expect(normalize(-1, arr)).toBe(-127);
  });

  test('rounds to nearest integer', () => {
    const arr = new Uint8Array(1);
    expect(normalize(0.5 / 255, arr)).toBe(1);
    expect(normalize(0.4 / 255, arr)).toBe(0);
  });

  test('throws for unsupported array type', () => {
    const arr = new Uint8ClampedArray(1);
    expect(() => normalize(0.5, arr)).toThrow('Invalid component type.');
  });

  test('throws for plain number array', () => {
    expect(() => normalize(0.5, [] as unknown as Float32Array)).toThrow('Invalid component type.');
  });
});

describe('denormalize', () => {
  test('returns the value unchanged for Float32Array', () => {
    const arr = new Float32Array(1);
    expect(denormalize(0.5, arr)).toBe(0.5);
    expect(denormalize(-0.5, arr)).toBe(-0.5);
  });

  test('scales from Uint32 range to [0, 1]', () => {
    const arr = new Uint32Array(1);
    expect(denormalize(0, arr)).toBe(0);
    expect(denormalize(4294967295, arr)).toBe(1);
    expect(denormalize(2147483647, arr)).toBeCloseTo(0.5, 5);
  });

  test('scales from Uint16 range to [0, 1]', () => {
    const arr = new Uint16Array(1);
    expect(denormalize(0, arr)).toBe(0);
    expect(denormalize(65535, arr)).toBe(1);
  });

  test('scales from Uint8 range to [0, 1]', () => {
    const arr = new Uint8Array(1);
    expect(denormalize(0, arr)).toBe(0);
    expect(denormalize(255, arr)).toBe(1);
    expect(denormalize(128, arr)).toBeCloseTo(128 / 255, 5);
  });

  test('scales from Int32 range to [-1, 1] and clamps below -1', () => {
    const arr = new Int32Array(1);
    expect(denormalize(0, arr)).toBe(0);
    expect(denormalize(2147483647, arr)).toBe(1);
    expect(denormalize(-2147483647, arr)).toBe(-1);
    // -2147483648 / 2147483647 < -1, so denormalize should clamp to -1.
    expect(denormalize(-2147483648, arr)).toBe(-1);
  });

  test('scales from Int16 range to [-1, 1] and clamps below -1', () => {
    const arr = new Int16Array(1);
    expect(denormalize(0, arr)).toBe(0);
    expect(denormalize(32767, arr)).toBe(1);
    expect(denormalize(-32767, arr)).toBe(-1);
    expect(denormalize(-32768, arr)).toBe(-1);
  });

  test('scales from Int8 range to [-1, 1] and clamps below -1', () => {
    const arr = new Int8Array(1);
    expect(denormalize(0, arr)).toBe(0);
    expect(denormalize(127, arr)).toBe(1);
    expect(denormalize(-127, arr)).toBe(-1);
    expect(denormalize(-128, arr)).toBe(-1);
  });

  test('throws for unsupported array type', () => {
    const arr = new Uint8ClampedArray(1);
    expect(() => denormalize(0.5, arr)).toThrow('Invalid component type.');
  });

  test('throws for plain number array', () => {
    expect(() => denormalize(0.5, [] as unknown as Float32Array)).toThrow('Invalid component type.');
  });
});

describe('normalize / denormalize round-trip', () => {
  test('round-trips through Uint8Array within rounding tolerance', () => {
    const arr = new Uint8Array(1);
    const original = 0.5;
    const normalized = normalize(original, arr);
    expect(denormalize(normalized, arr)).toBeCloseTo(original, 2);
  });

  test('round-trips through Int16Array within rounding tolerance', () => {
    const arr = new Int16Array(1);
    const original = -0.75;
    const normalized = normalize(original, arr);
    expect(denormalize(normalized, arr)).toBeCloseTo(original, 4);
  });
});
