import { describe, expect, it } from 'vitest';

import { CameraData, getCameraData } from '~/core/CameraData';
import type { RenderSession } from '~/core/render-passes/RenderSession';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { Vector3 } from '~/math/vector/Vector3';
import { Camera3D } from '~/scene/cameras/Camera3D';
import { View3D } from '~/scene/View3D';

describe('CameraData', () => {
  const near = 0.5;
  const far = 40;
  const view = new Matrix4();
  const position = new Vector3();

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
    expect(data.lightTiles.depthMasks.every((mask) => mask === -1)).toBe(true);
    expect(data.uniformGroup.uniforms.uLightDepthMasks).toBe(data.lightTiles.depthMasks);
    expect(data.uniformGroup.uniforms.uLightDepthPlane).toBe(data.lightTiles.depthPlane);

    const view3d = new View3D({ width: 64, height: 64 });
    const session = { view3d } as RenderSession;
    const dirtyId = data.uniformGroup._dirtyId;

    data.prepareLightTiles(session);
    expect(
      data.lightTiles.masks.every((mask) => mask === 0),
      'no lights bins to all zeros',
    ).toBe(true);
    expect(data.uniformGroup._dirtyId).not.toBe(dirtyId);

    const preparedId = data.uniformGroup._dirtyId;
    data.prepareLightTiles(session);
    expect(data.uniformGroup._dirtyId, 'a second upload in the same session changes nothing').toBe(preparedId);

    view3d.destroy();
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

function project(viewProjection: Matrix4, x: number, y: number, z: number): [number, number] {
  const e = viewProjection.elements;
  const w = e[3] * x + e[7] * y + e[11] * z + e[15];
  return [(e[0] * x + e[4] * y + e[8] * z + e[12]) / w, (e[1] * x + e[5] * y + e[9] * z + e[13]) / w];
}

function cameraAt(camera: Camera3D, x: number): Camera3D {
  camera.position.set(x, 0, 10);
  camera.updateLocalTransform();
  camera.worldTransform.copyFrom(camera.localTransform);
  camera.view.getInverse(camera.worldTransform);
  camera.projection.makePerspective(1, 1.5, 0.5, 40);
  camera.viewProjection.multiplyMatrices(camera.projection, camera.view);
  return camera;
}

describe('CameraData previous view-projection', () => {
  const viewport = { x: 0, y: 0, width: 300, height: 200 };
  const points: [number, number, number][] = [
    [0, 0, 0],
    [1.5, -2, -3],
    [-4, 1, 6],
  ];

  const motion = (data: CameraData): [number, number][] =>
    points.map(([x, y, z]) => {
      const [cx, cy] = project(data.viewProjection, x, y, z);
      const [px, py] = project(data.previousViewProjection, x, y, z);
      return [cx - px, cy - py];
    });

  it('starts the previous view-projection at the first render, so nothing reads as moving', () => {
    const camera = cameraAt(new Camera3D(), 0);
    camera.jitter.set(3, -2);
    const data = new CameraData().syncFromCamera(camera, true, true, viewport);

    expect(data.uniformGroup.uniforms.uPreviousViewProjectionMatrix).toBe(data.previousViewProjection);
    for (const [dx, dy] of motion(data)) {
      expect(dx).toBeCloseTo(0, 6);
      expect(dy).toBeCloseTo(0, 6);
    }
    camera.destroy();
  });

  it('reads no motion on the render after a cut, then rolls on from it', () => {
    const camera = cameraAt(new Camera3D(), 0);
    const data = getCameraData(camera).syncFromCamera(camera, true, true, viewport);

    cameraAt(camera, 2);
    camera.resetHistory();
    data.syncFromCamera(camera, true, true, viewport);
    for (const [dx, dy] of motion(data)) {
      expect(dx, 'the jump across the cut reads no motion').toBeCloseTo(0, 6);
      expect(dy).toBeCloseTo(0, 6);
    }

    cameraAt(camera, 3);
    data.syncFromCamera(camera, true, true, viewport);
    expect(Math.abs(motion(data)[0][0]), 'the next render reads the move from the cut').toBeGreaterThan(1e-3);
    camera.destroy();
  });

  it('rolls the previous view-projection forward once per render, with the jitter cancelling', () => {
    const still = cameraAt(new Camera3D(), 0);
    const stillData = new CameraData().syncFromCamera(still, true, true, viewport);
    still.jitter.set(-1, 4);
    stillData.syncFromCamera(still, true, true, viewport);
    for (const [dx, dy] of motion(stillData)) {
      expect(dx, 'a still camera with a changing jitter reads no motion').toBeCloseTo(0, 6);
      expect(dy).toBeCloseTo(0, 6);
    }

    const plain = cameraAt(new Camera3D(), 0);
    const plainData = new CameraData().syncFromCamera(plain, true, true, viewport);
    cameraAt(plain, 2);
    plainData.syncFromCamera(plain, true, true, viewport);

    const camera = cameraAt(new Camera3D(), 0);
    camera.jitter.set(3, -2);
    const data = new CameraData().syncFromCamera(camera, true, true, viewport);
    cameraAt(camera, 2);
    camera.jitter.set(-1, 4);
    data.syncFromCamera(camera, true, true, viewport);

    const expected = motion(plainData);
    motion(data).forEach(([dx, dy], i) => {
      expect(Math.abs(expected[i][0]), 'the camera moved between the renders').toBeGreaterThan(1e-3);
      expect(dx, 'the motion of the same camera without a jitter').toBeCloseTo(expected[i][0], 6);
      expect(dy).toBeCloseTo(expected[i][1], 6);
    });

    const previous = Float32Array.from(data.previousViewProjection.elements);
    data.set(new Vector3(), new Matrix4(), new Matrix4().makeOrthographic(-1, 1, 1, -1, 0.1, 10));
    expect(data.previousViewProjection.elements, 'set() alone, as a shadow cascade calls it, never rolls').toEqual(
      previous,
    );

    for (const c of [still, plain, camera]) c.destroy();
  });

  it('flips the previous view-projection for each render, whatever the previous target was', () => {
    const camera = cameraAt(new Camera3D(), 1);
    const data = new CameraData().syncFromCamera(camera, true, false, viewport);

    for (const flipY of [false, true, false]) {
      data.syncFromCamera(camera, flipY, false, viewport);
      for (const [x, y, z] of points) {
        const [cx, cy] = project(data.viewProjection, x, y, z);
        const [px, py] = project(data.previousViewProjection, x, y, z);
        expect(px, 'a still camera reads no motion').toBeCloseTo(cx, 6);
        expect(py).toBeCloseTo(cy, 6);
      }
    }
    camera.destroy();
  });
});
