import { Assets } from 'pixi.js';
import { describe, expect, test } from 'vitest';

import '~/assets/init';
import { processMeshes } from '~/assets/loaders/gltf/process/processMeshes';
import { glbToGltf } from '~/assets/loaders/gltf/utils/glbToGltf';
import { Scene3DSource } from '~/assets/Scene3DSource';
import { computeBoundsFromPositions } from '~/geometry/utils/Geometry3DUtils';
import { getAttributeData } from '~/geometry/utils/getAttributeData';

import { model } from '../../../../examples/assets/manifest';

const UNNORMALIZED_DUCK = model('gltf.DuckQuantized');
const NORMALIZED_SHADER_BALL = model('gltf.ShaderBall');
const SHADER_BALL_STORED_POSITION_MAX = [32767, 30799, 31823];
const SHADER_BALL_VERTEX_COUNT = 36228;

function worstUnitError(normals: Float32Array): number {
  let worst = 0;
  for (let i = 0; i < normals.length; i += 3) {
    worst = Math.max(worst, Math.abs(Math.hypot(normals[i], normals[i + 1], normals[i + 2]) - 1));
  }
  return worst;
}

describe('KHR_mesh_quantization', () => {
  test('unnormalized integer positions and UVs load as raw integer formats, with the accessor bounds as stored', async () => {
    const source = await Assets.load<Scene3DSource>(UNNORMALIZED_DUCK);
    const geometry = source.geometries[0][0];

    expect(geometry.attributes.aPosition.format).toBe('uint16x4');
    expect(geometry.attributes.aUV.format).toBe('uint16x2');
    expect(geometry.bounds3D.max.toArray()).toEqual([16383, 15251, 11411]);
  });

  test('normalized integer positions and UVs load as normalized formats, with the accessor bounds divided down', async () => {
    const source = await Assets.load<Scene3DSource>(NORMALIZED_SHADER_BALL);
    const geometry = source.geometries[0][0];

    expect(geometry.attributes.aPosition.format).toBe('snorm16x4');
    expect(geometry.attributes.aUV.format).toBe('unorm16x2');
    expect(geometry.vertexCount).toBe(SHADER_BALL_VERTEX_COUNT);

    const max = geometry.bounds3D.max.toArray();
    const min = geometry.bounds3D.min.toArray();
    for (let i = 0; i < 3; i++) {
      expect(max[i]).toBeCloseTo(SHADER_BALL_STORED_POSITION_MAX[i] / 32767, 6);
      expect(min[i]).toBeCloseTo(-SHADER_BALL_STORED_POSITION_MAX[i] / 32767, 6);
    }
  });

  test('getAttributeData reads 8-bit normals as unit floats and raw integer positions as stored', async () => {
    const source = await Assets.load<Scene3DSource>(UNNORMALIZED_DUCK);
    const geometry = source.geometries[0][0];

    expect(geometry.attributes.aNormal.format).toBe('snorm8x4');

    const normals = getAttributeData(geometry, 'aNormal', 3);
    expect(normals.length).toBe(geometry.vertexCount * 3);
    expect(worstUnitError(normals)).toBeLessThan(0.01);

    const positions = getAttributeData(geometry, 'aPosition', 3);
    expect(computeBoundsFromPositions(positions).max.toArray()).toEqual(geometry.bounds3D.max.toArray());
  });

  test('getAttributeData reads normalized 16-bit positions and normals as floats', async () => {
    const source = await Assets.load<Scene3DSource>(NORMALIZED_SHADER_BALL);
    const geometry = source.geometries[0][0];

    expect(geometry.attributes.aNormal.format).toBe('snorm16x4');

    const positions = getAttributeData(geometry, 'aPosition', 3);
    expect(computeBoundsFromPositions(positions).max.y).toBeCloseTo(geometry.bounds3D.max.y, 6);

    expect(worstUnitError(getAttributeData(geometry, 'aNormal', 3))).toBeLessThan(0.005);
  });

  test('integer positions without accessor min and max fail the load, naming the accessor', async () => {
    const { json, buffers } = glbToGltf(await (await fetch(NORMALIZED_SHADER_BALL)).arrayBuffer());
    delete json.accessors![2].min;
    delete json.accessors![2].max;

    await expect(processMeshes(json, buffers, new Scene3DSource({}))).rejects.toThrow(/POSITION accessor 2/);
  });
});
