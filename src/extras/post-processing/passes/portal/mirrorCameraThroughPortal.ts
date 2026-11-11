import { Matrix4 } from '../../../../math/matrix/Matrix4';
import { Plane } from '../../../../math/shapes/Plane';
import { Vector3 } from '../../../../math/vector/Vector3';

/** Spelled out because `makeRotationY(Math.PI)` leaves a 1.2e-16 sine that tilts the camera and shears the seam */
const TURN_AROUND = new Matrix4().set(-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1);

const _inverseEntry = new Matrix4();
const _entryLocal = new Matrix4();
const _turned = new Matrix4();
const _viewMatrix = new Matrix4();
const _normal = new Vector3();
const _point = new Vector3();

/**
 * Poses a portal camera behind the exit exactly as the viewer stands before the entry
 *
 * A portal faces its local `+Z`, as an unrotated {@link PlaneGeometry} does: the entry's `+Z` side
 * holds the viewer, and the exit's holds the room the portal shows. The result is
 * `exit · turnAround · entry⁻¹ · viewer`, where `turnAround` is a half-turn about the portal's up
 * axis, so a viewer `d` in front of the entry lands `d` behind the exit, looking out through it.
 *
 * A scale on one portal node that the other doesn't share carries into the camera, so give both the
 * same scale.
 * @param entryWorld - World transform of the portal the viewer is looking at.
 * @param exitWorld - World transform of the portal on the far side.
 * @param viewerWorld - World transform of the camera doing the looking.
 * @param out - Matrix to write the portal camera's world transform into.
 * @returns The written matrix.
 * @category extras:post-processing
 * @advanced
 */
export function mirrorCameraThroughPortal(
  entryWorld: Matrix4,
  exitWorld: Matrix4,
  viewerWorld: Matrix4,
  out: Matrix4 = new Matrix4(),
): Matrix4 {
  _inverseEntry.getInverse(entryWorld);
  _entryLocal.multiplyMatrices(_inverseEntry, viewerWorld);
  _turned.multiplyMatrices(TURN_AROUND, _entryLocal);

  return out.multiplyMatrices(exitWorld, _turned);
}

/**
 * Writes the exit surface as a clipping plane in the portal camera's view space
 *
 * Set the result as the camera's {@link Camera3D#clippingPlane} and it keeps only what lies beyond
 * the exit, so the wall the exit sits in, and anything else between the camera and the opening,
 * is left out. The plane sits `bias` past the surface, so the exit quad itself is cut too rather
 * than flickering across the opening.
 * @param exitWorld - World transform of the exit portal; its `+Z` side is kept.
 * @param cameraWorld - World transform of the portal camera, as {@link mirrorCameraThroughPortal} wrote it; the
 *   camera's `view` matrix still holds last frame's pose at that point.
 * @param out - Plane to write into.
 * @param bias - How far past the exit surface to cut, in world units. The default suits a scene
 *   authored in metres; scale it with the scene.
 * @returns The written plane, in the camera's view space.
 * @category extras:post-processing
 * @advanced
 */
export function portalExitClipPlane(
  exitWorld: Matrix4,
  cameraWorld: Matrix4,
  out: Plane = new Plane(),
  bias = 0.001,
): Plane {
  _normal.setFromMatrixColumn(exitWorld, 2).normalize();
  exitWorld.extractPosition(_point);
  out.setFromNormalAndCoplanarPoint(_normal, _point);

  _viewMatrix.getInverse(cameraWorld);
  out.applyMatrix4(_viewMatrix);

  out.constant -= bias;

  return out;
}
