import { Buffer, BufferUsage, Geometry } from 'pixi.js';
import type { TypedArray, VertexFormat } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { Geometry3D } from '~/geometry/Geometry3D';
import { TorusKnotGeometry } from '~/geometry/TorusKnotGeometry';
import { getAttributeData } from '~/geometry/utils/getAttributeData';

function plainGeometry(data: TypedArray, format: VertexFormat): Geometry {
  return new Geometry({
    attributes: { aData: { buffer: new Buffer({ data, usage: BufferUsage.VERTEX }), format } },
  });
}

describe('getAttributeData', () => {
  it('reads default 16-bit normals as floats, three per vertex', () => {
    const q = new TorusKnotGeometry();
    const f = new TorusKnotGeometry({ quantizeNormals: false });

    const quantized = getAttributeData(q, 'aNormal', 3);
    const float = getAttributeData(f, 'aNormal', 3);

    expect(q.attributes.aNormal.format).toBe('snorm16x4');
    expect(quantized.length).toBe(q.vertexCount * 3);
    for (let i = 0; i < quantized.length; i++) {
      expect(Math.abs(quantized[i] - float[i])).toBeLessThanOrEqual(1 / 32767);
    }
    expect(Array.from(float)).toEqual(Array.from(f.normals!));

    q.destroy();
    f.destroy();
  });

  it('reads each attribute out of an interleaved buffer the same as from separate buffers', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const options = {
      positions,
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
      normals: new Float32Array([0, 0, 1, 0, 1, 0, 1, 0, 0]),
      tangents: new Float32Array([1, 0, 0, -1, 0, 1, 0, -1, 0, 0, 1, -1]),
    };
    const interleaved = new Geometry3D({ ...options, interleave: true });
    const separate = new Geometry3D({ ...options, interleave: false });

    for (const [id, size] of [
      ['aPosition', 3],
      ['aUV', 2],
      ['aNormal', 3],
      ['aTangent', 4],
    ] as const) {
      expect(Array.from(getAttributeData(interleaved, id, size))).toEqual(
        Array.from(getAttributeData(separate, id, size)),
      );
    }

    const tangents = getAttributeData(interleaved, 'aTangent', 4);
    for (let i = 3; i < tangents.length; i += 4) expect(tangents[i]).toBe(-1);
    expect(Array.from(getAttributeData(interleaved, 'aPosition', 3))).toEqual(Array.from(positions));

    interleaved.destroy();
    separate.destroy();
  });

  it.each([
    ['snorm8x4', new Int8Array([127, -127, -128, 0, 0, 64, -64, 9]), 3, [1, -1, -1, 0, 64 / 127, -64 / 127]],
    ['unorm8x4', new Uint8Array([255, 0, 51, 7]), 4, [1, 0, 0.2, 7 / 255]],
    ['snorm16x2', new Int16Array([32767, -32768]), 2, [1, -1]],
    ['unorm16x2', new Uint16Array([65535, 0, 32768, 1]), 2, [1, 0, 32768 / 65535, 1 / 65535]],
    ['uint16x2', new Uint16Array([16383, 2]), 2, [16383, 2]],
    ['sint16x4', new Int16Array([-5, 7, 300, 0]), 3, [-5, 7, 300]],
    ['sint32x2', new Int32Array([-70000, 3]), 2, [-70000, 3]],
    ['float32x3', new Float32Array([0.5, -2, 3]), 3, [0.5, -2, 3]],
  ] as const)('decodes %s as the shader reads it', (format, data, size, expected) => {
    const geometry = plainGeometry(data, format);
    const result = getAttributeData(geometry, 'aData', size);

    expect(result.length).toBe(expected.length);
    expected.forEach((value, i) => expect(result[i]).toBeCloseTo(value, 6));

    geometry.destroy();
  });

  it('fills the out array and returns it, so meshes merge into one array', () => {
    const aPositions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const bPositions = new Float32Array([2, 0, 0, 3, 0, 0, 2, 1, 0, 3, 1, 0]);
    const a = new Geometry3D({ positions: aPositions });
    const b = new Geometry3D({ positions: bPositions });
    const merged = new Float32Array(21);
    const head = merged.subarray(0, 9);
    const tail = merged.subarray(9);

    expect(getAttributeData(a, 'aPosition', 3, head)).toBe(head);
    expect(getAttributeData(b, 'aPosition', 3, tail)).toBe(tail);
    expect(Array.from(merged)).toEqual([...aPositions, ...bPositions]);
    expect(() => getAttributeData(b, 'aPosition', 3, new Float32Array(11))).toThrow(/needs 12/);

    a.destroy();
    b.destroy();
  });

  it('reads data that starts partway into its ArrayBuffer', () => {
    const geometry = new Geometry3D({ positions: new Float32Array([7, 7, 7, 0, 0, 0, 1, 0, 0, 0, 1, 0]).subarray(3) });

    expect(Array.from(getAttributeData(geometry, 'aPosition', 3))).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);

    geometry.destroy();
  });

  it('throws for a missing attribute, a size the format lacks, and an unsupported format', () => {
    const geometry = new Geometry3D({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    });
    const half = plainGeometry(new Uint16Array(4), 'float16x2');

    expect(() => getAttributeData(geometry, 'aTangent', 4)).toThrow(/no aTangent/);
    expect(() => getAttributeData(geometry, 'aUV', 3)).toThrow(/aUV/);
    expect(() => getAttributeData(half, 'aData', 2)).toThrow(/float16x2/);

    geometry.destroy();
    half.destroy();
  });
});
