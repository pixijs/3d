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

describe('mirrorCameraThroughPortal', () => {
  it('stands the camera behind the exit at the distance the viewer stands before the entry', () => {
    const entry = pose(0, 0, 0);
    const exit = pose(10, 0, 0);
    // Portals face local +Z, so a viewer at +Z with no rotation is standing in front of the
    // entry looking straight at it (a camera's own forward is -Z).
    const viewer = pose(0, 0, 4);

    const camera = mirrorCameraThroughPortal(entry, exit, viewer);
    const p = position(camera);

    // 4 behind the exit, on the far side of its surface...
    expect(p.x).toBeCloseTo(10, 4);
    expect(p.y).toBeCloseTo(0, 4);
    expect(p.z).toBeCloseTo(-4, 4);

    // ...looking back out through it, along the exit's +Z.
    const f = forward(camera);
    expect(f.x).toBeCloseTo(0, 4);
    expect(f.y).toBeCloseTo(0, 4);
    expect(f.z).toBeCloseTo(1, 4);
  });

  it('swaps left for right and leaves up alone', () => {
    const entry = pose(0, 0, 0);
    const exit = pose(10, 0, 0);
    const viewer = pose(-1.5, 0.8, 4);

    const p = position(mirrorCameraThroughPortal(entry, exit, viewer));

    // Left of the entry (-X) becomes right of the exit (+X): the half-turn is about the
    // portal's up axis, so X and Z flip and Y rides through.
    expect(p.x).toBeCloseTo(11.5, 4);
    expect(p.y).toBeCloseTo(0.8, 4);
    expect(p.z).toBeCloseTo(-4, 4);
  });

  it('composes through a rotated pair', () => {
    const entry = pose(-3, 1.6, 2, 0.7);
    const exit = pose(12, 0.4, -8, -2.1);
    const viewer = pose(1.2, 2.4, 5.5, 1.9);

    const camera = mirrorCameraThroughPortal(entry, exit, viewer);

    // The picture through the opening is unchanged, which is the whole point: the exit sits in
    // the portal camera's frame exactly where the entry sits in the viewer's.
    const entryFromViewer = localPoint(viewer, position(entry));
    const exitFromCamera = localPoint(camera, position(exit));
    expect(exitFromCamera.x).toBeCloseTo(entryFromViewer.x, 4);
    expect(exitFromCamera.y).toBeCloseTo(entryFromViewer.y, 4);
    expect(exitFromCamera.z).toBeCloseTo(entryFromViewer.z, 4);

    // Up survives the half-turn, so the far room is not upside down.
    const entryUpFromViewer = localPoint(viewer, axis(entry, 1).add(position(entry)));
    const exitUpFromCamera = localPoint(camera, axis(exit, 1).add(position(exit)));
    expect(exitUpFromCamera.x).toBeCloseTo(entryUpFromViewer.x, 4);
    expect(exitUpFromCamera.y).toBeCloseTo(entryUpFromViewer.y, 4);
    expect(exitUpFromCamera.z).toBeCloseTo(entryUpFromViewer.z, 4);

    // And the camera stands as far behind the exit's surface as the viewer stands in front of
    // the entry's — the two signed distances are equal and opposite.
    const viewerDepth = axis(entry, 2).dot(position(viewer).subtract(position(entry)));
    const cameraDepth = axis(exit, 2).dot(position(camera).subtract(position(exit)));
    expect(viewerDepth).toBeGreaterThan(0);
    expect(cameraDepth).toBeCloseTo(-viewerDepth, 4);
  });

  it('degenerates to a window when the exit is the entry turned around in place', () => {
    const entry = pose(2, 1, -4, 0.35);
    // Same position, facing the other way — the two faces of one hole in a wall. The pair's own
    // half-turn cancels against that, so the camera is the viewer and the portal is a window.
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
  it('passes through the exit surface, keeping the far side and discarding the camera side', () => {
    const entry = pose(0, 0, 0);
    const exit = pose(10, 0, 0);
    const viewer = pose(0, 0, 4);
    const camera = mirrorCameraThroughPortal(entry, exit, viewer);

    // Bias off, so the geometry is pinned on its own.
    const plane = portalExitClipPlane(exit, camera, undefined, 0);

    // On the surface: zero, wherever on it you stand.
    expect(clipDistance(plane, camera, new Vector3(10, 0, 0))).toBeCloseTo(0, 4);
    expect(clipDistance(plane, camera, new Vector3(11.4, -0.9, 0))).toBeCloseTo(0, 4);

    // Beyond the exit (its +Z half) is the room being shown: kept, so positive.
    expect(clipDistance(plane, camera, new Vector3(10, 0, 3))).toBeCloseTo(3, 4);

    // Between the camera and the exit — the wall the opening is cut into: discarded, so negative.
    expect(clipDistance(plane, camera, new Vector3(10, 0, -1))).toBeCloseTo(-1, 4);

    // The oblique near-plane construction needs the plane facing away from the camera, i.e. the
    // camera itself on the discarded side.
    expect(clipDistance(plane, camera, position(camera))).toBeLessThan(0);
  });

  it('holds for a rotated exit', () => {
    const entry = pose(-3, 1.6, 2, 0.7);
    const exit = pose(12, 0.4, -8, -2.1);
    const viewer = pose(1.2, 2.4, 5.5, 1.9);
    const camera = mirrorCameraThroughPortal(entry, exit, viewer);

    const plane = portalExitClipPlane(exit, camera, undefined, 0);
    const exitCentre = position(exit);
    const exitNormal = axis(exit, 2);

    expect(clipDistance(plane, camera, exitCentre)).toBeCloseTo(0, 4);
    // A metre out along the exit's own up axis is still on the surface.
    expect(clipDistance(plane, camera, exitCentre.clone().add(axis(exit, 1)))).toBeCloseTo(0, 4);
    // A metre along its facing normal is a metre into the kept half.
    expect(clipDistance(plane, camera, exitCentre.clone().add(exitNormal))).toBeCloseTo(1, 4);
    expect(clipDistance(plane, camera, exitCentre.clone().addScaledVector(exitNormal, -1))).toBeCloseTo(-1, 4);
    expect(clipDistance(plane, camera, position(camera))).toBeLessThan(0);
  });

  it('cuts just past the surface by default, so the exit quad itself is discarded', () => {
    const entry = pose(0, 0, 0);
    const exit = pose(10, 0, 0);
    const viewer = pose(0, 0, 4);
    const camera = mirrorCameraThroughPortal(entry, exit, viewer);

    const plane = portalExitClipPlane(exit, camera);

    // The exit's own vertices land on the discarded side rather than exactly on the boundary,
    // where float error would decide each one separately.
    expect(clipDistance(plane, camera, position(exit))).toBeLessThan(0);
    expect(clipDistance(plane, camera, new Vector3(11.4, -0.9, 0))).toBeLessThan(0);

    // A hair, not a slice: a centimetre into the far room is still kept.
    expect(clipDistance(plane, camera, new Vector3(10, 0, 0.01))).toBeGreaterThan(0);
  });
});
