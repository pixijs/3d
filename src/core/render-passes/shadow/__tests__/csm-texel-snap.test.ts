import { describe, expect, it } from 'vitest';

import { Matrix4 } from '~/math/matrix/Matrix4';
import { Box } from '~/math/shapes/Box';

import { computeFixedBoxMatrix } from '../csmUtils';

const MAP_SIZE = 1024;

/**
 * Slack for float32 matrix storage, as a fraction of a texel
 *
 * `Matrix4.elements` is a Float32Array, so a window centred tens of thousands of units out
 * carries a few parts per million of noise. Judging everything in texels keeps the tolerance
 * meaningful at every window size.
 */
const TEXEL_EPSILON = 0.01;

/**
 * The light-space window an ortho projection describes, back out of the matrix.
 *
 * `elements[0]` is `2 / width` and `elements[12]` is `-centre / halfExtent`, so both come
 * straight back out — in world units, which is what the snapping has to be judged in.
 */
function windowOf(projection: Matrix4): { centreX: number; centreY: number; halfX: number; halfY: number } {
  const te = projection.elements;
  const halfX = 1 / te[0];
  const halfY = 1 / te[5];

  return { centreX: -te[12] * halfX, centreY: -te[13] * halfY, halfX, halfY };
}

/** Fits the shadow window to a box of `size`, centred at `centre`, with the light axis-aligned. */
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
    // 400-unit box: one texel is a little under 0.43 world units at 1024.
    const base = fit(1000, 400);
    const texelWorld = (2 * base.halfX) / MAP_SIZE;

    const nudged = fit(1000 + texelWorld * 0.3, 400);

    expect(nudged.centreX).toBe(base.centreX);
    expect(nudged.centreY).toBe(base.centreY);
  });

  it('steps by whole texels once the box moves past one', () => {
    const base = fit(1000, 400);
    const texelWorld = (2 * base.halfX) / MAP_SIZE;

    const moved = fit(1000 + texelWorld * 4.6, 400);
    const steps = (moved.centreX - base.centreX) / texelWorld;

    expect(Math.abs(steps - Math.round(steps))).toBeLessThan(TEXEL_EPSILON);
    expect(Math.round(steps)).toBe(4);
  });

  it('never displaces the window by more than one texel, at any size', () => {
    // Sizes spanning a tight near cascade through to an outer one, each centred far from the
    // origin — a cascade follows the camera, so its centre is wherever the camera is. Quantising
    // the projection's normalised translation by a world texel size failed here by hundreds of
    // texels, and worse the larger the window.
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

  it('leaves the window size untouched', () => {
    // Padded by 5% of the box's full width on each side, so an 800-unit box gives 440.
    const w = fit(137.7, 800);

    expect(w.halfX).toBeCloseTo(440, 3);
    expect(w.halfY).toBeCloseTo(440, 3);
  });
});
