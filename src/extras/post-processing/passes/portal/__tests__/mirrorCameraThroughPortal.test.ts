import { describe, expect, it } from 'vitest';

import {
  mirrorCameraThroughPortal,
  portalExitClipPlane,
} from '~/extras/post-processing/passes/portal/mirrorCameraThroughPortal';
import { Matrix4 } from '~/math/matrix/Matrix4';
import type { Plane } from '~/math/shapes/Plane';
import { Vector3 } from '~/math/vector/Vector3';

/** A rigid pose: yaw about Y, then a translation. Portal nodes and cameras are both built this way. */
function pose(x: number, y: number, z: number, yaw = 0): Matrix4 {
  return new Matrix4().makeRotationY(yaw).setPosition({ x, y, z });
}

/** Where `world` sits in `frame`'s own coordinates */
function localPoint(frame: Matrix4, world: Vector3): Vector3 {
  return world.clone().applyMatrix4(new Matrix4().getInverse(frame));
}

/** Which way `frame`'s local axis `column` points, in world space */
function axis(frame: Matrix4, column: 0 | 1 | 2): Vector3 {
  return new Vector3().setFromMatrixColumn(frame, column).normalize();
}

/** Signed distance from a world-space point to a plane already expressed in `cameraWorld`'s view space */
function clipDistance(plane: Plane, cameraWorld: Matrix4, world: Vector3): number {
  return plane.distanceToPoint(localPoint(cameraWorld, world));
}

const position = (m: Matrix4) => m.extractPosition(new Vector3());
/** A camera's own forward is its negated Z; a portal's facing side is its positive Z. */
const forward = (m: Matrix4) => m.extractForward(new Vector3());

/** An entry, an exit and a viewer, each yawed and moved off the axes */
function rotatedPair(): { entry: Matrix4; exit: Matrix4; viewer: Matrix4; camera: Matrix4 } {
  const entry = pose(-3, 1.6, 2, 0.7);
  const exit = pose(12, 0.4, -8, -2.1);
  const viewer = pose(1.2, 2.4, 5.5, 1.9);

  return { entry, exit, viewer, camera: mirrorCameraThroughPortal(entry, exit, viewer) };
}

describe('mirrorCameraThroughPortal', () => {
  it('stands the camera behind the exit at the distance the viewer stands before the entry, looking out', () => {
    const entry = pose(0, 0, 0);
    const exit = pose(10, 0, 0);
    const viewerFourInFrontOfEntry = pose(0, 0, 4);

    const camera = mirrorCameraThroughPortal(entry, exit, viewerFourInFrontOfEntry);
    const p = position(camera);

    expect(p.x).toBeCloseTo(10, 4);
    expect(p.y).toBeCloseTo(0, 4);
    expect(p.z).toBeCloseTo(-4, 4);

    const f = forward(camera);
    expect(f.x).toBeCloseTo(0, 4);
    expect(f.y).toBeCloseTo(0, 4);
    expect(f.z).toBeCloseTo(1, 4);
  });

  it("puts the exit in the camera's frame where the entry sits in the viewer's, for a rotated pair", () => {
    const { entry, exit, viewer, camera } = rotatedPair();

    const entryFromViewer = localPoint(viewer, position(entry));
    const exitFromCamera = localPoint(camera, position(exit));
    expect(exitFromCamera.x).toBeCloseTo(entryFromViewer.x, 4);
    expect(exitFromCamera.y).toBeCloseTo(entryFromViewer.y, 4);
    expect(exitFromCamera.z).toBeCloseTo(entryFromViewer.z, 4);
  });

  it("keeps the exit's up axis where the entry's sits for the viewer, so the far room is upright", () => {
    const { entry, exit, viewer, camera } = rotatedPair();

    const entryUpFromViewer = localPoint(viewer, axis(entry, 1).add(position(entry)));
    const exitUpFromCamera = localPoint(camera, axis(exit, 1).add(position(exit)));
    expect(exitUpFromCamera.x).toBeCloseTo(entryUpFromViewer.x, 4);
    expect(exitUpFromCamera.y).toBeCloseTo(entryUpFromViewer.y, 4);
    expect(exitUpFromCamera.z).toBeCloseTo(entryUpFromViewer.z, 4);
  });

  it('stands the camera as far behind a rotated exit as the viewer stands in front of the entry', () => {
    const { entry, exit, viewer, camera } = rotatedPair();

    const viewerDepth = axis(entry, 2).dot(position(viewer).subtract(position(entry)));
    const cameraDepth = axis(exit, 2).dot(position(camera).subtract(position(exit)));
    expect(viewerDepth).toBeGreaterThan(0);
    expect(cameraDepth).toBeCloseTo(-viewerDepth, 4);
  });

  it('degenerates to a window when the exit is the entry turned around in place', () => {
    const entry = pose(2, 1, -4, 0.35);
    const exit = pose(2, 1, -4, 0.35 + Math.PI);
    const viewer = pose(-1, 2, 3, 1.1);

    const camera = mirrorCameraThroughPortal(entry, exit, viewer);
    const p = position(camera);
    const v = position(viewer);

    expect(p.x).toBeCloseTo(v.x, 4);
    expect(p.y).toBeCloseTo(v.y, 4);
    expect(p.z).toBeCloseTo(v.z, 4);
  });
});

describe('portalExitClipPlane', () => {
  it("lays the plane on a rotated exit, keeping the side it faces and cutting the camera's side", () => {
    const { exit, camera } = rotatedPair();

    const plane = portalExitClipPlane(exit, camera, undefined, 0);
    const exitCentre = position(exit);
    const exitNormal = axis(exit, 2);
    const metreUpTheSurface = exitCentre.clone().add(axis(exit, 1));
    const metreInFront = exitCentre.clone().add(exitNormal);
    const metreBehind = exitCentre.clone().addScaledVector(exitNormal, -1);

    expect(clipDistance(plane, camera, exitCentre)).toBeCloseTo(0, 4);
    expect(clipDistance(plane, camera, metreUpTheSurface)).toBeCloseTo(0, 4);
    expect(clipDistance(plane, camera, metreInFront)).toBeCloseTo(1, 4);
    expect(clipDistance(plane, camera, metreBehind)).toBeCloseTo(-1, 4);
    expect(clipDistance(plane, camera, position(camera))).toBeLessThan(0);
  });

  it('cuts just past the surface by default, discarding the exit quad but keeping a centimetre beyond', () => {
    const entry = pose(0, 0, 0);
    const exit = pose(10, 0, 0);
    const viewer = pose(0, 0, 4);
    const camera = mirrorCameraThroughPortal(entry, exit, viewer);

    const plane = portalExitClipPlane(exit, camera);
    const pointOnExitSurface = new Vector3(11.4, -0.9, 0);
    const centimetreIntoFarRoom = new Vector3(10, 0, 0.01);

    expect(clipDistance(plane, camera, position(exit))).toBeLessThan(0);
    expect(clipDistance(plane, camera, pointOnExitSurface)).toBeLessThan(0);
    expect(clipDistance(plane, camera, centimetreIntoFarRoom)).toBeGreaterThan(0);
  });
});
