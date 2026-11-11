import { describe, expect, it } from 'vitest';

import { Matrix4 } from '~/math/matrix/Matrix4';
import { Box } from '~/math/shapes/Box';

import { computeFixedBoxMatrix } from '../csmUtils';

const MAP_SIZE = 1024;

const TEXEL_EPSILON = 0.01;

function windowOf(projection: Matrix4): { centreX: number; centreY: number; halfX: number; halfY: number } {
  const te = projection.elements;
  const halfX = 1 / te[0];
  const halfY = 1 / te[5];

  return { centreX: -te[12] * halfX, centreY: -te[13] * halfY, halfX, halfY };
}

function fit(centre: number, size: number, mapSize = MAP_SIZE) {
  const half = size * 0.5;
  const bounds = new Box();
  bounds.set({ x: centre - half, y: centre - half, z: -half }, { x: centre + half, y: centre + half, z: half });

  const projection = new Matrix4();
  computeFixedBoxMatrix(bounds, new Matrix4(), projection, mapSize);

  return windowOf(projection);
}

describe('shadow window texel snapping', () => {
  it('lands the window centre on a texel boundary', () => {
    for (const [centre, size] of [
      [0, 20],
      [137.7, 200],
      [-4321.5, 640],
      [98765.4, 3000],
    ]) {
      const w = fit(centre, size);
      const texelWorld = (2 * w.halfX) / MAP_SIZE;
      const texels = w.centreX / texelWorld;

      expect(Math.abs(texels - Math.round(texels)), `centre ${centre}, size ${size}`).toBeLessThan(TEXEL_EPSILON);
    }
  });

  it('holds the window still while the box drifts under a texel', () => {
    const base = fit(1000, 400);
    const texelWorld = (2 * base.halfX) / MAP_SIZE;

    const nudged = fit(1000 + texelWorld * 0.3, 400);

    expect(nudged.centreX).toBe(base.centreX);
    expect(nudged.centreY).toBe(base.centreY);
  });

  it('never displaces the window by more than one texel, at any size from a near cascade to an outer one, far from the origin', () => {
    for (const [centre, size] of [
      [40, 20],
      [200, 100],
      [600, 348],
      [1234.5, 348],
      [-7654.3, 1644],
      [98765.4, 3000],
    ]) {
      const w = fit(centre, size);
      const texelWorld = (2 * w.halfX) / MAP_SIZE;

      expect(Math.abs(w.centreX - centre), `centre ${centre}, size ${size}`).toBeLessThan(texelWorld);
      expect(Math.abs(w.centreY - centre), `centre ${centre}, size ${size}`).toBeLessThan(texelWorld);
    }
  });
});
