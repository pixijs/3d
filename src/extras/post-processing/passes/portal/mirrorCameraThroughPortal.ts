import { Matrix4 } from '../../../../math/matrix/Matrix4';
import { Plane } from '../../../../math/shapes/Plane';
import { Vector3 } from '../../../../math/vector/Vector3';

/**
 * A half-turn about the portal's own up axis — `diag(-1, 1, -1, 1)`
 *
 * Spelled out rather than built with `makeRotationY(Math.PI)`, whose sine is 1.2e-16 rather than
 * zero: that leak would tilt every portal camera by a hair and shear the seam.
 */
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
 * **Which way a portal faces: local +Z is the side the viewer stands on.** A portal built from a
 * {@link PlaneGeometry} needs no rotation to obey that — the plane lies in its local XY with a
 * `+Z` normal, so the face you can see is the face you walk up to. The entry's `+Z` half-space
 * holds the viewer; the exit's `+Z` half-space holds the room the portal shows.
 *
 * The camera is the viewer, carried through the pair:
 *
 * ```text
 * portalCamera = exit · turnAround · entry⁻¹ · viewer
 * ```
 *
 * Read right to left: put the viewer in the entry's frame, spin a half-turn about the portal's
 * up axis, then plant that frame on the exit. The half-turn is what makes it a doorway rather
 * than a window — it swaps front for back and left for right, so a viewer standing `d` in front
 * of the entry lands `d` *behind* the exit looking out through it, and stepping left slides the
 * far room right, exactly as a real opening would.
 *
 * Both nodes must be rigid — rotation and translation only. Scale on a portal node would ride
 * through `entry⁻¹` into the camera's own transform; size the quad's geometry instead.
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
 * Hand the result to {@link Camera3D#clippingPlane} and the projection's near plane is replaced
 * by this one (the Lengyel oblique construction), so the camera keeps only what lies beyond the
 * exit. That is the whole reason a texture portal doesn't need per-camera hiding: the wall the
 * exit sits in, and everything else between the camera and the opening, is discarded by the
 * projection rather than by a visibility flag.
 *
 * Sign follows the plane the camera must *keep*: the normal is the exit's world `+Z`, the side
 * its viewer stands on and therefore the side the far room is on. The camera sits on the other
 * side, so its own signed distance to the plane is negative — which is exactly the "plane faces
 * away from the camera" precondition the oblique construction needs.
 *
 * The plane is pushed `bias` past the surface it was built from, so the exit quad itself lands on
 * the discarded side. Without that the quad's own vertices sit exactly on the new near plane and
 * float error decides each one separately, which rasterises a flickering sliver right across the
 * opening.
 * @param exitWorld - World transform of the exit portal; its `+Z` is the kept half-space.
 * @param cameraWorld - World transform of the portal camera, as
 *   {@link mirrorCameraThroughPortal} wrote it.
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
  // Column 2 is the exit's +Z axis in world space; `extractForward` would hand back its negation
  // (the camera convention), which is the half we throw away.
  _normal.setFromMatrixColumn(exitWorld, 2).normalize();
  exitWorld.extractPosition(_point);
  out.setFromNormalAndCoplanarPoint(_normal, _point);

  // Into the camera's view space. The projection builder forms this same inverse later in the
  // frame, but it has not run yet — the camera's own `view` is still last frame's.
  _viewMatrix.getInverse(cameraWorld);
  out.applyMatrix4(_viewMatrix);

  // Slide the plane along its own normal, deeper into the half being kept.
  out.constant -= bias;

  return out;
}
