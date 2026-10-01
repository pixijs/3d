import { describe, expect, test } from 'vitest';

import { Spherical } from '~/math/shapes/Spherical';
import { Vector3 } from '~/math/vector/Vector3';

describe('Spherical', () => {
  describe('constructor', () => {
    test('defaults to radius=1, phi=0, theta=0', () => {
      const s = new Spherical();
      expect(s.radius).toBe(1);
      expect(s.phi).toBe(0);
      expect(s.theta).toBe(0);
    });

    test('respects supplied components', () => {
      const s = new Spherical(5, Math.PI / 3, Math.PI / 4);
      expect(s.radius).toBe(5);
      expect(s.phi).toBe(Math.PI / 3);
      expect(s.theta).toBe(Math.PI / 4);
    });
  });

  describe('set', () => {
    test('sets all three components', () => {
      const s = new Spherical();
      s.set(2, Math.PI / 2, Math.PI / 4);
      expect(s.radius).toBe(2);
      expect(s.phi).toBe(Math.PI / 2);
      expect(s.theta).toBe(Math.PI / 4);
    });
  });

  describe('copyFrom', () => {
    test('copies all three components', () => {
      const a = new Spherical(2, Math.PI / 3, Math.PI / 6);
      const b = new Spherical();
      b.copyFrom(a);
      expect(b.radius).toBe(2);
      expect(b.phi).toBe(Math.PI / 3);
      expect(b.theta).toBe(Math.PI / 6);
    });
  });

  describe('copyTo', () => {
    test('copies into target and returns target', () => {
      const a = new Spherical(3, 0.5, 1.5);
      const b = new Spherical();
      const result = a.copyTo(b);
      expect(result).toBe(b);
      expect(b.radius).toBe(3);
      expect(b.phi).toBe(0.5);
      expect(b.theta).toBe(1.5);
    });
  });

  describe('clone', () => {
    test('returns a new Spherical with the same values', () => {
      const a = new Spherical(2, 0.7, 0.3);
      const b = a.clone();
      expect(b).not.toBe(a);
      expect(b.radius).toBe(2);
      expect(b.phi).toBe(0.7);
      expect(b.theta).toBe(0.3);
    });
  });

  describe('equals', () => {
    test('returns true for matching components', () => {
      const a = new Spherical(2, 0.5, 1.5);
      const b = new Spherical(2, 0.5, 1.5);
      expect(a.equals(b)).toBe(true);
    });

    test('returns false for differing radius', () => {
      const a = new Spherical(2, 0.5, 1.5);
      const b = new Spherical(3, 0.5, 1.5);
      expect(a.equals(b)).toBe(false);
    });

    test('returns false for differing phi', () => {
      const a = new Spherical(2, 0.5, 1.5);
      const b = new Spherical(2, 0.4, 1.5);
      expect(a.equals(b)).toBe(false);
    });

    test('returns false for differing theta', () => {
      const a = new Spherical(2, 0.5, 1.5);
      const b = new Spherical(2, 0.5, 1.4);
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('makeSafe', () => {
    test('clamps phi=0 to EPS', () => {
      const s = new Spherical(1, 0, 0);
      s.makeSafe();
      expect(s.phi).toBeCloseTo(0.000001, 10);
      expect(s.phi).toBeGreaterThan(0);
    });

    test('clamps phi=PI to PI-EPS', () => {
      const s = new Spherical(1, Math.PI, 0);
      s.makeSafe();
      expect(s.phi).toBeCloseTo(Math.PI - 0.000001, 10);
      expect(s.phi).toBeLessThan(Math.PI);
    });

    test('leaves phi=PI/2 unchanged', () => {
      const s = new Spherical(1, Math.PI / 2, 0);
      s.makeSafe();
      expect(s.phi).toBe(Math.PI / 2);
    });

    test('clamps phi values past PI down to PI-EPS', () => {
      const s = new Spherical(1, Math.PI + 1, 0);
      s.makeSafe();
      expect(s.phi).toBeCloseTo(Math.PI - 0.000001, 10);
    });

    test('clamps negative phi up to EPS', () => {
      const s = new Spherical(1, -1, 0);
      s.makeSafe();
      expect(s.phi).toBeCloseTo(0.000001, 10);
    });
  });

  describe('setFromPoint3D', () => {
    test('equivalent to setFromCartesianCoords(v.x, v.y, v.z)', () => {
      const a = new Spherical();
      const b = new Spherical();
      a.setFromPoint3D({ x: 1, y: 2, z: 3 });
      b.setFromCartesianCoords(1, 2, 3);
      expect(a.radius).toBeCloseTo(b.radius, 5);
      expect(a.phi).toBeCloseTo(b.phi, 5);
      expect(a.theta).toBeCloseTo(b.theta, 5);
    });
  });

  describe('setFromCartesianCoords', () => {
    test('(0, 0, 0) collapses radius=0, theta=0, phi=0', () => {
      const s = new Spherical(99, 99, 99);
      s.setFromCartesianCoords(0, 0, 0);
      expect(s.radius).toBe(0);
      expect(s.phi).toBe(0);
      expect(s.theta).toBe(0);
    });

    test('(0, 1, 0) gives radius=1, phi=0 (pointing along +Y)', () => {
      const s = new Spherical();
      s.setFromCartesianCoords(0, 1, 0);
      expect(s.radius).toBeCloseTo(1, 5);
      expect(s.phi).toBeCloseTo(0, 5);
    });

    test('(0, 0, 1) gives radius=1, phi=PI/2, theta=0 (pointing along +Z)', () => {
      const s = new Spherical();
      s.setFromCartesianCoords(0, 0, 1);
      expect(s.radius).toBeCloseTo(1, 5);
      expect(s.phi).toBeCloseTo(Math.PI / 2, 5);
      expect(s.theta).toBeCloseTo(0, 5);
    });

    test('(1, 0, 0) gives radius=1, phi=PI/2, theta=PI/2', () => {
      const s = new Spherical();
      s.setFromCartesianCoords(1, 0, 0);
      expect(s.radius).toBeCloseTo(1, 5);
      expect(s.phi).toBeCloseTo(Math.PI / 2, 5);
      expect(s.theta).toBeCloseTo(Math.PI / 2, 5);
    });

    test('round-trip: setFromCartesianCoords then Vector3.setFromSpherical recovers original', () => {
      const cases: Array<[number, number, number]> = [
        [1, 2, 3],
        [-2, 4, -1],
        [0.5, -0.7, 1.2],
        [10, 0, 0],
        [0, -5, 0],
      ];

      for (const [x, y, z] of cases) {
        const s = new Spherical().setFromCartesianCoords(x, y, z);
        const recovered = new Vector3().setFromSpherical(s);
        expect(recovered.x).toBeCloseTo(x, 5);
        expect(recovered.y).toBeCloseTo(y, 5);
        expect(recovered.z).toBeCloseTo(z, 5);
      }
    });
  });
});
