import { Buffer, BufferUsage } from 'pixi.js';
import type { Attribute, VertexFormat } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { Geometry3D } from '~/geometry/Geometry3D';
import { Box } from '~/math/shapes/Box';
import { Vector3 } from '~/math/vector/Vector3';

const FLOAT_POSITIONS = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);

const INT16_POSITIONS = new Int16Array([0, 0, 0, 0, 32767, 0, 0, 0, 0, 32767, 0, 0]);

function positionAttribute(format: VertexFormat): Attribute {
  return {
    buffer: new Buffer({ data: INT16_POSITIONS, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST }),
    format,
  };
}

describe('Geometry3D vertex formats', () => {
  it.each(['sint16x4', 'snorm16x4'] as const)(
    'keeps a %s position Attribute as given, with the bounds passed in',
    (format) => {
      const bounds3D = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 0));

      for (const interleave of [false, true]) {
        const geometry = new Geometry3D({ positions: positionAttribute(format), bounds3D, interleave });

        expect(geometry.attributes.aPosition.format).toBe(format);
        expect(geometry.vertexCount).toBe(3);
        expect(geometry.bounds3D).toBe(bounds3D);
      }
    },
  );

  it('throws for an integer position Attribute with no bounds3D', () => {
    expect(() => new Geometry3D({ positions: positionAttribute('snorm16x4') })).toThrow(/need bounds3D/);
  });

  it('throws for an integer typed array as positions or UVs, which could be normalized or raw integers', () => {
    const integers = new Int16Array(9) as unknown as Float32Array;
    const integerUvs = new Uint16Array(6) as unknown as Float32Array;

    for (const interleave of [false, true]) {
      expect(() => new Geometry3D({ positions: integers, interleave })).toThrow(/aPosition got Int16Array data/);
      expect(() => new Geometry3D({ positions: FLOAT_POSITIONS, uvs: integerUvs, interleave })).toThrow(
        /aUV got Uint16Array data/,
      );
    }
  });

  it('reads an integer typed array the one way each other attribute can mean', () => {
    for (const interleave of [false, true]) {
      const geometry = new Geometry3D({
        positions: FLOAT_POSITIONS,
        normals: new Int8Array(9) as unknown as Float32Array,
        joints: new Uint8Array(12),
        weights: new Uint8Array(12),
        colors: new Uint8Array(12),
        colors1: new Float32Array(12),
        interleave,
      });

      expect(geometry.attributes.aNormal.format).toBe('snorm8x4');
      expect(geometry.attributes.aJoints.format).toBe('uint8x4');
      expect(geometry.attributes.aWeights.format).toBe('unorm8x4');
      expect(geometry.attributes.aColor.format).toBe('unorm8x4');
      expect(geometry.attributes.aColor1.format).toBe('float32x4');
    }
  });
});
