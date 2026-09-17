import { Assets } from 'pixi.js';
import { describe, expect, test } from 'vitest';

import '~/assets/init';
import type { Scene3DSource } from '~/assets/Scene3DSource';

describe('EXT_meshopt_compression / KHR_meshopt_compression', () => {
  test('non-meshopt GLBs still load after refactor (regression)', async () => {
    const source = await Assets.load<Scene3DSource>('/avocado.glb');
    expect(source.geometries.length).toBeGreaterThan(0);
    const geometry = source.geometries[0][0];
    expect(geometry.positions.length).toBeGreaterThan(0);
    expect(geometry.indexBuffer!.data.length).toBeGreaterThan(0);
  }, 30000);

  test('decodes a meshopt-compressed glTF into usable Geometry3D', async () => {
    const source = await Assets.load<Scene3DSource>('/brainstem-meshopt/BrainStem.gltf');

    expect(source).toBeTruthy();
    expect(source.geometries.length).toBeGreaterThan(0);

    const geometry = source.geometries[0][0];
    expect(geometry).toBeTruthy();

    const positions = geometry.positions;
    expect(positions).toBeTruthy();
    expect(positions.length).toBeGreaterThan(0);
    expect(positions.length % 3).toBe(0);

    const indexBuffer = geometry.indexBuffer;
    expect(indexBuffer).toBeTruthy();
    expect(indexBuffer!.data.length).toBeGreaterThan(0);
    expect(indexBuffer!.data.length % 3).toBe(0);
  }, 30000);
});
