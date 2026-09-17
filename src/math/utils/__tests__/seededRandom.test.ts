import { describe, expect, test } from 'vitest';

import { seededRandom } from '~/math/utils/seededRandom';

describe('seededRandom', () => {
  test('returns a function', () => {
    expect(typeof seededRandom('hello')).toBe('function');
  });

  test('produces values in [0, 1)', () => {
    const random = seededRandom('range-test');
    for (let i = 0; i < 1000; i++) {
      const v = random();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('same seed produces the same sequence', () => {
    const a = seededRandom('seed-a');
    const b = seededRandom('seed-a');
    for (let i = 0; i < 50; i++) {
      expect(a()).toBe(b());
    }
  });

  test('different seeds produce different sequences', () => {
    const a = seededRandom('seed-a');
    const b = seededRandom('seed-b');
    let differs = false;
    for (let i = 0; i < 20; i++) {
      if (a() !== b()) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });

  test('successive calls with same seed produce different values (advancing state)', () => {
    const random = seededRandom('advancing');
    const first = random();
    const second = random();
    expect(first).not.toBe(second);
  });

  test('handles empty string seed', () => {
    const random = seededRandom('');
    const v = random();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  test('handles long string seed', () => {
    const longSeed = 'a'.repeat(1000);
    const random = seededRandom(longSeed);
    for (let i = 0; i < 10; i++) {
      const v = random();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('handles unicode in seed', () => {
    const a = seededRandom('seed-emoji');
    const b = seededRandom('seed-emoji');
    expect(a()).toBe(b());
  });

  test('produces a reasonably uniform distribution', () => {
    const random = seededRandom('uniform-test');
    const buckets: number[] = Array.from({ length: 10 }, () => 0);
    const samples = 10000;
    for (let i = 0; i < samples; i++) {
      buckets[Math.floor(random() * 10)]++;
    }
    // Each bucket should be roughly samples / 10 = 1000. Allow generous margin.
    for (const count of buckets) {
      expect(count).toBeGreaterThan(700);
      expect(count).toBeLessThan(1300);
    }
  });
});
