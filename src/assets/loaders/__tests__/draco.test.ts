import { Assets } from 'pixi.js';
import { describe, expect, test } from 'vitest';

import '~/assets/init';
import type { Scene3DSource } from '~/assets/Scene3DSource';

describe('KHR_draco_mesh_compression', () => {
  test('decodes a Draco-compressed glTF into usable Geometry3D', async () => {
    const source = await Assets.load<Scene3DSource>('/water-bottle-draco/WaterBottle.gltf');

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
