import { describe, expect, test } from 'vitest';

import { Cylindrical } from '~/math/shapes/Cylindrical';
import { Vector3 } from '~/math/vector/Vector3';

describe('Cylindrical', () => {
  describe('constructor', () => {
    test('defaults to radius=1, theta=0, y=0', () => {
      const c = new Cylindrical();
      expect(c.radius).toBe(1);
      expect(c.theta).toBe(0);
      expect(c.y).toBe(0);
    });

    test('respects supplied components', () => {
      const c = new Cylindrical(2, Math.PI / 4, 5);
      expect(c.radius).toBe(2);
      expect(c.theta).toBe(Math.PI / 4);
      expect(c.y).toBe(5);
    });
  });

  describe('set', () => {
    test('sets all three components', () => {
      const c = new Cylindrical();
      c.set(3, Math.PI / 6, 7);
      expect(c.radius).toBe(3);
      expect(c.theta).toBe(Math.PI / 6);
      expect(c.y).toBe(7);
    });
  });

  describe('copyFrom', () => {
    test('copies all three components', () => {
      const a = new Cylindrical(2, Math.PI / 3, 4);
      const b = new Cylindrical();
      b.copyFrom(a);
      expect(b.radius).toBe(2);
      expect(b.theta).toBe(Math.PI / 3);
      expect(b.y).toBe(4);
    });
  });

  describe('copyTo', () => {
    test('copies into target and returns target', () => {
      const a = new Cylindrical(3, 0.5, 1.5);
      const b = new Cylindrical();
      const result = a.copyTo(b);
      expect(result).toBe(b);
      expect(b.radius).toBe(3);
      expect(b.theta).toBe(0.5);
      expect(b.y).toBe(1.5);
    });
  });

  describe('clone', () => {
    test('returns a new Cylindrical with the same values', () => {
      const a = new Cylindrical(2, 0.7, 0.3);
      const b = a.clone();
      expect(b).not.toBe(a);
      expect(b.radius).toBe(2);
      expect(b.theta).toBe(0.7);
      expect(b.y).toBe(0.3);
    });
  });

  describe('equals', () => {
    test('returns true for matching components', () => {
      const a = new Cylindrical(2, 0.5, 1.5);
      const b = new Cylindrical(2, 0.5, 1.5);
      expect(a.equals(b)).toBe(true);
    });

    test('returns false for differing radius', () => {
      const a = new Cylindrical(2, 0.5, 1.5);
      const b = new Cylindrical(3, 0.5, 1.5);
      expect(a.equals(b)).toBe(false);
    });

    test('returns false for differing theta', () => {
      const a = new Cylindrical(2, 0.5, 1.5);
      const b = new Cylindrical(2, 0.4, 1.5);
      expect(a.equals(b)).toBe(false);
    });

    test('returns false for differing y', () => {
      const a = new Cylindrical(2, 0.5, 1.5);
      const b = new Cylindrical(2, 0.5, 1.4);
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('setFromPoint3D', () => {
    test('equivalent to setFromCartesianCoords(v.x, v.y, v.z)', () => {
      const a = new Cylindrical();
      const b = new Cylindrical();
      a.setFromPoint3D({ x: 1, y: 2, z: 3 });
      b.setFromCartesianCoords(1, 2, 3);
      expect(a.radius).toBeCloseTo(b.radius, 5);
      expect(a.theta).toBeCloseTo(b.theta, 5);
      expect(a.y).toBeCloseTo(b.y, 5);
    });
  });

  describe('setFromCartesianCoords', () => {
    test('(0, 5, 0) gives radius=0, theta=0, y=5', () => {
      const c = new Cylindrical();
      c.setFromCartesianCoords(0, 5, 0);
      expect(c.radius).toBeCloseTo(0, 5);
      expect(c.theta).toBeCloseTo(0, 5);
      expect(c.y).toBe(5);
    });

    test('(0, 0, 1) gives radius=1, theta=0, y=0', () => {
      const c = new Cylindrical();
      c.setFromCartesianCoords(0, 0, 1);
      expect(c.radius).toBeCloseTo(1, 5);
      expect(c.theta).toBeCloseTo(0, 5);
      expect(c.y).toBe(0);
    });

    test('(1, 2, 0) gives radius=1, theta=PI/2, y=2', () => {
      const c = new Cylindrical();
      c.setFromCartesianCoords(1, 2, 0);
      expect(c.radius).toBeCloseTo(1, 5);
      expect(c.theta).toBeCloseTo(Math.PI / 2, 5);
      expect(c.y).toBe(2);
    });

    test('round-trip: setFromCartesianCoords then Vector3.setFromCylindrical recovers original', () => {
      const cases: Array<[number, number, number]> = [
        [1, 2, 3],
        [-2, 4, -1],
        [0.5, -0.7, 1.2],
        [10, 0, 0],
        [0, 5, 0],
        [3, -3, 4],
      ];

      for (const [x, y, z] of cases) {
        const c = new Cylindrical().setFromCartesianCoords(x, y, z);
        const recovered = new Vector3().setFromCylindrical(c);
        expect(recovered.x).toBeCloseTo(x, 5);
        expect(recovered.y).toBeCloseTo(y, 5);
        expect(recovered.z).toBeCloseTo(z, 5);
      }
    });
  });
});
