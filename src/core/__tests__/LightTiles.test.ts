import { describe, expect, it } from 'vitest';

import {
  binLightTiles,
  LIGHT_DEPTH_BINS,
  LIGHT_TILE_COUNT,
  LIGHT_TILE_LANES,
  LIGHT_TILES_X,
  LIGHT_TILES_Y,
  LightTiles,
} from '~/core/LightTiles';
import type { RenderSession } from '~/core/render-passes/RenderSession';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { PointLight } from '~/scene/lights/PointLight';
import { updateView3DTransforms } from '~/scene/utils/updateView3DTransforms';
import { FLOATS_PER_LIGHT, View3D } from '~/scene/View3D';

const TILE_COUNT = LIGHT_TILES_X * LIGHT_TILES_Y;
const LIGHT_POINT = 1;
const identity = new Matrix4();
const LIGHT_DIRECTIONAL = 0;

/** A packed list holding just what the binning reads: position, type and range */
function packLights(lights: { position: number[]; type?: number; range: number }[]): Float32Array {
  const data = new Float32Array(lights.length * FLOATS_PER_LIGHT);
  lights.forEach(({ position, type = LIGHT_POINT, range }, i) => {
    data.set(position, i * FLOATS_PER_LIGHT);
    data[i * FLOATS_PER_LIGHT + 3] = type;
    data[i * FLOATS_PER_LIGHT + 7] = range;
  });
  return data;
}

function bin(lights: Float32Array, viewProjection: Matrix4): Int32Array {
  const out = new Int32Array(LIGHT_TILE_LANES * 4);
  binLightTiles(out, lights, lights.length / FLOATS_PER_LIGHT, viewProjection, identity, new Float32Array(4));
  return out;
}

/** How many of the grid's tiles have bit `i` set */
function tilesSet(masks: Int32Array, i: number): number {
  let count = 0;
  for (let t = 0; t < TILE_COUNT; t++) if (masks[t] & (1 << i)) count++;
  return count;
}

/** The tile a world point lands in, or -1 when it is off screen or behind the camera */
function tileOf(viewProjection: Matrix4, x: number, y: number, z: number): number {
  const e = viewProjection.elements;
  const w = e[3] * x + e[7] * y + e[11] * z + e[15];
  if (w <= 0) return -1;
  const ndcX = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
  const ndcY = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
  if (ndcX <= -1 || ndcX >= 1 || ndcY <= -1 || ndcY >= 1) return -1;
  const tx = Math.floor((ndcX * 0.5 + 0.5) * LIGHT_TILES_X);
  const ty = Math.floor((ndcY * 0.5 + 0.5) * LIGHT_TILES_Y);
  return ty * LIGHT_TILES_X + tx;
}

/** Small deterministic generator, so a failure reproduces */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('binLightTiles', () => {
  // The camera sits at the origin looking down -z.
  const perspective = new Matrix4().makePerspective(1.2, 16 / 9, 0.1, 200);

  it('sets every tile for a directional light and for a light with no range', () => {
    const masks = bin(
      packLights([
        { position: [0, 0, 0], type: LIGHT_DIRECTIONAL, range: 0 },
        { position: [500, 0, 500], range: 0 },
      ]),
      perspective,
    );

    expect(tilesSet(masks, 0)).toBe(TILE_COUNT);
    expect(tilesSet(masks, 1)).toBe(TILE_COUNT);
  });

  it('sets no tiles for a light wholly behind the camera', () => {
    const masks = bin(packLights([{ position: [0, 0, 10], range: 3 }]), perspective);

    expect(tilesSet(masks, 0)).toBe(0);
  });

  it('sets every tile for a light that straddles the camera plane, and with the camera inside it', () => {
    const masks = bin(
      packLights([
        { position: [0, 0, 2], range: 3 },
        { position: [0, 0, 0], range: 5 },
      ]),
      perspective,
    );

    expect(tilesSet(masks, 0)).toBe(TILE_COUNT);
    expect(tilesSet(masks, 1)).toBe(TILE_COUNT);
  });

  it('sets no tiles for a light off to the side of the view', () => {
    const masks = bin(packLights([{ position: [200, 0, -20], range: 3 }]), perspective);

    expect(tilesSet(masks, 0)).toBe(0);
  });

  it('keeps a small centred light to the middle tiles', () => {
    const masks = bin(packLights([{ position: [0, 0, -50], range: 1 }]), perspective);
    const set = tilesSet(masks, 0);

    expect(set).toBeGreaterThan(0);
    expect(set).toBeLessThanOrEqual(4);
  });

  it('gives bit i to light i, and clears what the last bin left', () => {
    const out = new Int32Array(LIGHT_TILE_LANES * 4).fill(-1);
    const lights = packLights([
      { position: [200, 0, -20], range: 3 },
      { position: [0, 0, 0], type: LIGHT_DIRECTIONAL, range: 0 },
    ]);

    binLightTiles(out, lights, 2, perspective, identity, new Float32Array(4));

    for (let t = 0; t < TILE_COUNT; t++) expect(out[t]).toBe(0b10);
  });

  it('reaches bit 31', () => {
    const lights = new Float32Array(32 * FLOATS_PER_LIGHT);
    for (let i = 0; i < 32; i++) {
      lights.set([200, 0, -20, LIGHT_POINT], i * FLOATS_PER_LIGHT);
      lights[i * FLOATS_PER_LIGHT + 7] = 3;
    }
    lights.set([0, 0, -50], 31 * FLOATS_PER_LIGHT);

    const masks = bin(lights, perspective);

    expect(tilesSet(masks, 31)).toBeGreaterThan(0);
    expect(tilesSet(masks, 30)).toBe(0);
  });

  // The other half of the bound: it is no looser than a tile. A loose bound draws the same
  // picture, only slower, so nothing else would notice.
  it('covers no column or row beyond the ones the sphere lands in, give or take a tile', () => {
    const random = lcg(11);

    for (let n = 0; n < 100; n++) {
      const range = 1 + random() * 8;
      const position = [(random() - 0.5) * 60, (random() - 0.5) * 30, -15 - random() * 50];
      const masks = bin(packLights([{ position, range }]), perspective);

      let hitX0 = Infinity;
      let hitX1 = -Infinity;
      let hitY0 = Infinity;
      let hitY1 = -Infinity;
      // Columns and rows are bounded separately, so a sample counts toward an axis whenever
      // it is on screen along that axis.
      const e = perspective.elements;
      for (let s = 0; s < 4000; s++) {
        const theta = random() * Math.PI * 2;
        const cosPhi = random() * 2 - 1;
        const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
        const x = position[0] + range * sinPhi * Math.cos(theta);
        const y = position[1] + range * sinPhi * Math.sin(theta);
        const z = position[2] + range * cosPhi;
        const w = e[3] * x + e[7] * y + e[11] * z + e[15];
        const ndcX = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
        const ndcY = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;

        if (ndcX > -1 && ndcX < 1) {
          const tx = Math.floor((ndcX * 0.5 + 0.5) * LIGHT_TILES_X);
          hitX0 = Math.min(hitX0, tx);
          hitX1 = Math.max(hitX1, tx);
        }
        if (ndcY > -1 && ndcY < 1) {
          const ty = Math.floor((ndcY * 0.5 + 0.5) * LIGHT_TILES_Y);
          hitY0 = Math.min(hitY0, ty);
          hitY1 = Math.max(hitY1, ty);
        }
      }
      if (hitX0 === Infinity || hitY0 === Infinity) continue;

      for (let t = 0; t < TILE_COUNT; t++) {
        if ((masks[t] & 1) === 0) continue;
        const tx = t % LIGHT_TILES_X;
        const ty = Math.floor(t / LIGHT_TILES_X);
        expect(tx).toBeGreaterThanOrEqual(hitX0 - 1);
        expect(tx).toBeLessThanOrEqual(hitX1 + 1);
        expect(ty).toBeGreaterThanOrEqual(hitY0 - 1);
        expect(ty).toBeLessThanOrEqual(hitY1 + 1);
      }
    }
  });

  // The property that matters: a point a light can reach never lands in a tile whose bit is
  // clear. Off-axis lights are where a centre-plus-radius bound fails, so the lights are
  // scattered wide and the projections include a flipped, a lens-shifted and a rolled one. Many of
  // the lights cross the camera plane.
  it('never clears the bit of a tile a reachable point lands in', () => {
    const flipped = new Matrix4().makePerspective(1.2, 16 / 9, 0.1, 200);
    flipped.elements[5] *= -1;

    const shifted = new Matrix4().makePerspective(0.6, 1, 0.1, 200);
    shifted.elements[8] = 0.7;
    shifted.elements[9] = -0.4;

    const rolled = new Matrix4().makeRotationZ(0.6).multiply(new Matrix4().makePerspective(1.5, 1, 0.1, 200));

    const orthographic = new Matrix4().makeOrthographic(-20, 20, 12, -12, 0.1, 200);

    const random = lcg(7);
    const dropped: string[] = [];

    for (const projection of [perspective, flipped, shifted, rolled, orthographic]) {
      for (let n = 0; n < 200; n++) {
        const range = 0.5 + random() * 12;
        const position = [(random() - 0.5) * 120, (random() - 0.5) * 80, 5 - random() * 80];
        const masks = bin(packLights([{ position, range }]), projection);

        for (let s = 0; s < 200; s++) {
          // A point inside the range sphere: a random direction, a random distance.
          const theta = random() * Math.PI * 2;
          const cosPhi = random() * 2 - 1;
          const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
          const d = range * Math.cbrt(random());
          const tile = tileOf(
            projection,
            position[0] + d * sinPhi * Math.cos(theta),
            position[1] + d * sinPhi * Math.sin(theta),
            position[2] + d * cosPhi,
          );

          if (tile >= 0 && (masks[tile] & 1) === 0) {
            dropped.push(`light at ${position.join(', ')} range ${range} reaches tile ${tile}`);
          }
        }
      }
    }

    expect(dropped).toEqual([]);
  });
});

describe('LightTiles', () => {
  // The camera sits at the origin looking down -z.
  const viewProjection = new Matrix4().makePerspective(1, 1, 0.5, 40);

  /** A session holding only what `prepare` reads */
  function sessionFor(view3d: View3D): RenderSession {
    return { view3d } as RenderSession;
  }

  /** One ranged light far off to the side of the camera */
  function viewWithOffscreenLight(): View3D {
    const view3d = new View3D({ width: 64, height: 64 });
    const light = new PointLight({ range: 2 });
    light.position.set(500, 0, -10);
    view3d.root.addChild(light);
    updateView3DTransforms(view3d);
    view3d._lightDataList.reset();
    view3d._lightDataList.add(light);
    return view3d;
  }

  it('bins once a session, however many times the camera is prepared', () => {
    const tiles = new LightTiles();
    const view3d = viewWithOffscreenLight();
    const session = sessionFor(view3d);

    expect(tiles.masks.every((mask) => mask === -1)).toBe(true);

    expect(tiles.prepare(session, viewProjection, identity)).toBe(true);
    expect(tiles.masks.every((mask) => mask === 0)).toBe(true);

    // Same session: preparing again changes nothing.
    tiles.masks.fill(7);
    expect(tiles.prepare(session, viewProjection, identity)).toBe(false);
    expect(tiles.masks[0]).toBe(7);

    // A new session bins again.
    expect(tiles.prepare(sessionFor(view3d), viewProjection, identity)).toBe(true);
    expect(tiles.masks[0]).toBe(0);

    view3d.destroy();
  });
});

/** Float32 shader dot product, including clamping before conversion to an integer. */
function depthMask(grid: LightTiles, x: number, y: number, z: number): number {
  const p = grid.depthPlane;
  const dot = Math.fround(
    Math.fround(Math.fround(Math.fround(x) * p[0]) + Math.fround(Math.fround(y) * p[1])) +
      Math.fround(Math.fround(Math.fround(z) * p[2]) + p[3]),
  );
  return grid.masks[LIGHT_TILE_COUNT + Math.floor(Math.max(0, Math.min(LIGHT_DEPTH_BINS - 1, dot)))];
}

function binGrid(lights: Float32Array, projection: Matrix4, view: Matrix4 = identity): LightTiles {
  const grid = new LightTiles();
  binLightTiles(grid.masks, lights, lights.length / FLOATS_PER_LIGHT, projection, view, grid.depthPlane);
  return grid;
}

describe('camera-depth masks', () => {
  const projection = new Matrix4().makePerspective(1.2, 16 / 9, 0.1, 200);

  it('separates lights along a camera ray even when their screen tiles overlap', () => {
    const grid = binGrid(
      packLights([
        { position: [0, 0, -5], range: 1 },
        { position: [0, 0, -50], range: 1 },
      ]),
      projection,
    );
    const tile = tileOf(projection, 0, 0, -5);
    expect(grid.masks[tile]).toBe(0b11);
    expect(grid.masks[tile] & depthMask(grid, 0, 0, -5)).toBe(0b01);
    expect(grid.masks[tile] & depthMask(grid, 0, 0, -50)).toBe(0b10);
    expect(depthMask(grid, 0, 0, -25)).toBe(0);
  });

  it.each([0, -1, Infinity, NaN])('keeps global range %s out of the finite bounds', (range) => {
    const grid = binGrid(
      packLights([
        { position: [0, 0, -5], range },
        { position: [0, 0, -50], range: 1 },
      ]),
      projection,
    );
    expect(depthMask(grid, 0, 0, -50)).toBe(0b11);
    expect(grid.depthPlane.every(Number.isFinite)).toBe(true);
    for (let i = LIGHT_TILE_COUNT; i < grid.masks.length; i++) expect(grid.masks[i] & 1).toBe(1);
  });

  it('preserves bit 31 and resets the depth transform when the list is emptied', () => {
    const lights = packLights(
      Array.from({ length: 32 }, (_, i) => ({ position: [0, 0, i === 31 ? -50 : -5], range: 1 })),
    );
    const grid = binGrid(lights, projection);
    expect(depthMask(grid, 0, 0, -50)).toBe(1 << 31);
    expect(depthMask(grid, 0, 0, -5)).toBe(0x7fffffff);
    binLightTiles(grid.masks, lights, 0, projection, identity, grid.depthPlane);
    expect(grid.masks.every((mask) => mask === 0)).toBe(true);
    expect(Array.from(grid.depthPlane)).toEqual([0, 0, 0, 0]);
  });

  it('does not let offscreen lights stretch the depth bins', () => {
    const grid = binGrid(
      packLights([
        { position: [0, 0, -5], range: 1 },
        { position: [0, 0, -10], range: 1 },
        { position: [1e6, 0, -1e5], range: 1 },
      ]),
      projection,
    );
    expect(depthMask(grid, 0, 0, -7.5)).toBe(0);
  });

  it('bins depth along the camera axis, including a scaled view transform', () => {
    const view = new Matrix4().makeRotationY(Math.PI / 2);
    view.elements[2] *= 2;
    view.elements[6] *= 2;
    view.elements[10] *= 2;
    const viewProjection = new Matrix4().multiplyMatrices(projection, view);
    const grid = binGrid(
      packLights([
        { position: [5, 0, 0], range: 1 },
        { position: [50, 0, 0], range: 1 },
      ]),
      viewProjection,
      view,
    );
    expect(depthMask(grid, 5, 0, 0)).toBe(1);
    expect(depthMask(grid, 50, 0, 0)).toBe(2);
  });

  it('never drops reachable points across depth faces, translations and camera projections', () => {
    const random = lcg(13);
    let dropped = 0;
    for (const translation of [0, 1e6]) {
      const view = new Matrix4();
      view.elements[12] = -translation;
      view.elements[13] = -translation;
      view.elements[14] = -translation;
      const ortho = new Matrix4().makeOrthographic(-30, 30, 20, -20, 0.1, 200);
      for (const cameraProjection of [projection, ortho]) {
        const vp = new Matrix4().multiplyMatrices(cameraProjection, view);
        const lights = packLights(
          Array.from({ length: 32 }, () => ({
            position: [
              translation + (random() - 0.5) * 30,
              translation + (random() - 0.5) * 20,
              translation - 2 - random() * 90,
            ],
            range: 0.1 + random() * 8,
          })),
        );
        const grid = binGrid(lights, vp, view);
        for (let i = 0; i < 32; i++) {
          const o = i * FLOATS_PER_LIGHT;
          const range = lights[o + 7];
          for (let sample = 0; sample < 1000; sample++) {
            const theta = random() * Math.PI * 2;
            const cosPhi = random() * 2 - 1;
            const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
            const radius = range * Math.cbrt(random());
            const x = Math.fround(lights[o] + radius * sinPhi * Math.cos(theta));
            const y = Math.fround(lights[o + 1] + radius * sinPhi * Math.sin(theta));
            const z = Math.fround(lights[o + 2] + radius * cosPhi);
            if (Math.hypot(x - lights[o], y - lights[o + 1], z - lights[o + 2]) > range) continue;
            const tile = tileOf(vp, x, y, z);
            if (tile < 0) continue;
            if ((grid.masks[tile] & depthMask(grid, x, y, z) & (1 << i)) === 0) dropped++;
          }
        }
      }
    }
    expect(dropped).toBe(0);
  });
});
