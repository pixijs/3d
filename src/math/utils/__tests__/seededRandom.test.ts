import { describe, expect, test } from 'vitest';

import { seededRandom } from '~/math/utils/seededRandom';

describe('seededRandom', () => {
  test('produces values in [0, 1)', () => {
    const random = seededRandom('range-test');
    for (let i = 0; i < 1000; i++) {
      const v = random();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('sequence for a seed is stable', () => {
    const random = seededRandom('seed-a');
    const values = [random(), random(), random(), random()];
    expect(values).toEqual([0.9273967572953552, 0.9287577387876809, 0.05113196629099548, 0.7946995419915766]);
  });

  test('keeps its sequence where an unwrapped state would pass 2^53', () => {
    const drawWhereAnUnwrappedStatePasses2To53 = 4_917_758;
    const random = seededRandom('seed-a');
    for (let i = 1; i < drawWhereAnUnwrappedStatePasses2To53; i++) random();
    expect(random()).toBe(0.0006335657089948654);
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

  test('fills ten buckets within 30% of an even share', () => {
    const random = seededRandom('uniform-test');
    const buckets: number[] = Array.from({ length: 10 }, () => 0);
    const samples = 10000;
    for (let i = 0; i < samples; i++) {
      buckets[Math.floor(random() * 10)]++;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(700);
      expect(count).toBeLessThan(1300);
    }
  });
});
