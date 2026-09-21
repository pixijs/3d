import { describe, expect, it } from 'vitest';

import { CameraData } from '~/core/CameraData';
import type { RenderSession } from '~/core/render-passes/RenderSession';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { Vector3 } from '~/math/vector/Vector3';
import { PointLight } from '~/scene/lights/PointLight';
import { updateView3DTransforms } from '~/scene/utils/updateView3DTransforms';
import { View3D } from '~/scene/View3D';

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
  it('holds the viewport as the uViewport lane, wherever the image sits on the target', () => {
    const data = new CameraData().setViewport({ x: 150, y: 92, width: 300, height: 200 });
    const { x, y, width, height } = data.viewport;

    expect(data.uniformGroup.uniforms.uViewport).toBe(data.viewport);
    expect([x, y, width, height]).toEqual([150, 92, 300, 200]);
  });

  it('starts with a viewport the shader can divide by', () => {
    const { width, height } = new CameraData().viewport;

    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it('uploads the viewport only when it moves', () => {
    const data = new CameraData().setViewport({ x: 0, y: 0, width: 1080, height: 333 });
    const dirtyId = data.uniformGroup._dirtyId;

    data.setViewport({ x: 0, y: 0, width: 1080, height: 333 });
    expect(data.uniformGroup._dirtyId).toBe(dirtyId);

    data.setViewport({ x: 10, y: 0, width: 1080, height: 333 });
    expect(data.uniformGroup._dirtyId).not.toBe(dirtyId);
  });

  it('lights everything until the camera is uploaded, then uploads what was binned', () => {
    const data = new CameraData().set(position, view, new Matrix4().makePerspective(1, 1, near, far));

    expect(data.lightTiles.masks.every((mask) => mask === -1)).toBe(true);
    expect(data.uniformGroup.uniforms.uLightTiles).toBe(data.lightTiles.masks);
    expect(data.uniformGroup.uniforms.uLightDepthPlane).toBe(data.lightTiles.depthPlane);

    const view3d = new View3D({ width: 64, height: 64 });
    const session = { view3d } as RenderSession;
    const dirtyId = data.uniformGroup._dirtyId;

    // No lights bins to all zeros.
    data.prepareLightTiles(session);
    expect(data.lightTiles.masks.every((mask) => mask === 0)).toBe(true);
    expect(data.uniformGroup._dirtyId).not.toBe(dirtyId);

    // A second upload in the same session changes nothing.
    const preparedId = data.uniformGroup._dirtyId;
    data.prepareLightTiles(session);
    expect(data.uniformGroup._dirtyId).toBe(preparedId);

    view3d.destroy();
  });

  it('bins again when the camera changes within the same session', () => {
    const data = new CameraData();
    const view3d = new View3D({ width: 64, height: 64 });
    const light = new PointLight({ range: 1 });
    light.position.set(10, 0, -5);
    view3d.root.addChild(light);
    updateView3DTransforms(view3d);
    view3d._lightDataList.add(light);
    const session = { view3d } as RenderSession;
    const projection = new Matrix4().makePerspective(1, 1, near, far);

    try {
      data.set(position, view, projection);
      data.prepareLightTiles(session);
      expect(data.lightTiles.masks.every((mask) => mask === 0)).toBe(true);

      data.set(new Vector3(10, 0, 0), new Matrix4().makeTranslation(-10, 0, 0), projection);
      data.prepareLightTiles(session);
      expect(data.lightTiles.masks.some((mask) => mask !== 0)).toBe(true);
    } finally {
      data.destroy();
      view3d.destroy(true);
    }
  });

  it('releases the sessions retained by the camera and its light tiles on destroy', () => {
    const data = new CameraData();
    const view3d = new View3D({ width: 64, height: 64 });
    const session = { view3d } as RenderSession;
    const tiles = data.lightTiles as unknown as { _session: RenderSession | null };

    try {
      data._currentSession = session;
      data.prepareLightTiles(session);
      expect(data._currentSession).toBe(session);
      expect(tiles._session).toBe(session);

      data.destroy();
      data.destroy();

      expect(data._currentSession).toBeNull();
      expect(tiles._session).toBeNull();
      expect(data.bindGroup.resources).toBeNull();
    } finally {
      view3d.destroy(true);
    }
  });
});
