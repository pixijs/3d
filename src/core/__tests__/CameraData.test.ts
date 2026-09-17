import { describe, expect, it } from 'vitest';

import { CameraData } from '~/core/CameraData';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { Vector3 } from '~/math/vector/Vector3';

/** Clip z over w for a view-space point at `viewZ`, through `projection` */
function ndcZ(projection: Matrix4, viewZ: number): number {
  const p = new Vector3(0, 0, viewZ);
  const e = projection.elements;
  const z = e[2] * p.x + e[6] * p.y + e[10] * p.z + e[14];
  const w = e[3] * p.x + e[7] * p.y + e[11] * p.z + e[15];
  return z / w;
}

describe('CameraData', () => {
  const near = 0.5;
  const far = 40;
  const view = new Matrix4();
  const position = new Vector3();

  it('keeps the GL clip range by default, and never touches the camera projection it copies', () => {
    const projection = new Matrix4().makePerspective(1, 1, near, far);
    const before = Float32Array.from(projection.elements);

    const data = new CameraData().set(position, view, projection);

    expect(ndcZ(data.projection, -near)).toBeCloseTo(-1, 5);
    expect(ndcZ(data.projection, -far)).toBeCloseTo(1, 5);
    expect(projection.elements).toEqual(before);
  });

  it('remaps the bound copy to [0, 1] for WebGPU, perspective and orthographic alike', () => {
    for (const projection of [
      new Matrix4().makePerspective(1, 1, near, far),
      new Matrix4().makeOrthographic(-5, 5, 5, -5, near, far),
    ]) {
      const data = new CameraData().set(position, view, projection, false, true);

      expect(ndcZ(data.projection, -near)).toBeCloseTo(0, 5);
      expect(ndcZ(data.projection, -far)).toBeCloseTo(1, 5);
      expect(ndcZ(data.projection, -(near + far) / 2)).toBeGreaterThan(0);
    }
  });

  it('flips Y and remaps depth independently', () => {
    const projection = new Matrix4().makePerspective(1, 1, near, far);
    const data = new CameraData().set(position, view, projection, true, true);

    expect(Math.sign(data.projection.elements[5])).toBe(-1);
    expect(ndcZ(data.projection, -near)).toBeCloseTo(0, 5);
  });
});
