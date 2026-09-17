import { Bounds, Matrix, Point, Rectangle, RendererType } from 'pixi.js';
import type { PointData, WebGPURenderer } from 'pixi.js';

import { Matrix4 } from '../math/matrix/Matrix4';
import type { Camera3D } from '../scene/cameras/Camera3D';
import type { View3D } from '../scene/View3D';
import { getCameraData } from './CameraData';
import { frameToPhysicalViewport } from './render-graph/frameToPhysicalViewport';
import type { RenderSession } from './render-passes/RenderSession';

const _tempMatrix = new Matrix4();
const _tempMatrix2 = new Matrix4();
const _tempMatrix3 = new Matrix4();
const _screenBounds = new Rectangle();
const _targetBounds = new Rectangle();

/** Scratch the graph writes a viewport UV scale into on its way to a camera's lane */
const _uvScale = new Point();

/** The rect a camera's `viewport` marks out, in the pixels of the space `_placement` maps from */
const _local = new Rectangle();

/** Takes `_local` into the target: the View's world transform for the screen, identity for a texture */
const _placement = new Matrix();

/** `_local` through `_placement` as an axis-aligned box, before it is fitted to the target */
const _bounds = new Bounds();

/**
 * Places a camera's viewport in the View's screen space
 *
 * Writes `_local` — the viewport as a rect of the View in logical pixels, measured from the
 * anchor — and `_placement`, the View's world transform less the renderer's offset (nonzero
 * inside a filter, whose render target starts at the filter's bounds).
 * @param view3d - The 3D view supplying size, anchor, and world transform.
 * @param camera - The camera whose viewport is placed.
 * @param rendererOffset - The global uniform offset (accounts for filter bounds).
 */
function placeCameraInView(view3d: View3D, camera: Camera3D, rendererOffset: PointData): void {
  const { width, height } = view3d;
  const { x: ax, y: ay } = view3d.anchor;
  const { x: vx, y: vy, width: vw, height: vh } = camera.viewport;

  _local.set((vx - ax) * width, (vy - ay) * height, vw * width, vh * height);

  _placement.copyFrom(view3d.worldTransform);
  _placement.tx -= rendererOffset.x;
  _placement.ty -= rendererOffset.y;
}

/**
 * The rect `local` covers once placed, clipped to `bounds`
 *
 * Pixi's own transformed-box routine does the four corners. Empty (zero width or height) when
 * nothing of the rect lands inside `bounds`.
 * @param local - The rect to place.
 * @param placement - Where it lands.
 * @param bounds - What to clip it to, in the same space `placement` maps into.
 * @param out - Receives the clipped rect.
 * @returns `out`, for inline use.
 */
function fitFrame(local: Rectangle, placement: Matrix, bounds: Rectangle, out: Rectangle): Rectangle {
  _bounds.clear();
  _bounds.addFrame(local.x, local.y, local.x + local.width, local.y + local.height, placement);

  out.x = _bounds.minX;
  out.y = _bounds.minY;
  out.width = _bounds.maxX - _bounds.minX;
  out.height = _bounds.maxY - _bounds.minY;

  return out.fit(bounds);
}

/**
 * Patches a camera's projection to clip against its `clippingPlane`
 *
 * The standard oblique-frustum construction (Lengyel, "Modifying the Projection Matrix to
 * Perform Oblique Near-Plane Clipping"): the near plane is replaced by the camera's plane, so
 * everything on its negative side is clipped by the rasteriser at no per-fragment cost. This is
 * what a mirror or a portal cuts its scene with. No-op when there is no plane.
 * @param camera - The camera whose projection is patched.
 */
function applyClippingPlane(camera: Camera3D): void {
  const plane = camera.clippingPlane;
  if (!plane) return;

  const e = camera.projection.elements;
  const { x: nx, y: ny, z: nz } = plane.normal;
  const nw = plane.constant;

  // Clip-space corner opposite the plane, pulled back into camera space through the inverse of
  // the projection.
  const qx = (Math.sign(nx) + e[8]) / e[0];
  const qy = (Math.sign(ny) + e[9]) / e[5];
  const qz = -1;
  const qw = (1 + e[10]) / e[14];

  // Scale the plane so it lands exactly on the clip volume's near face, then it becomes the
  // projection's Z row.
  const s = 2 / (nx * qx + ny * qy + nz * qz + nw * qw);

  e[2] = nx * s;
  e[6] = ny * s;
  e[10] = nz * s + 1;
  e[14] = nw * s;
}

/**
 * Rebuilds a camera's view and projection for the rect its image lands in
 *
 * One placement rule for every camera. The projection is built for `local` — the rect the
 * camera's `viewport` marks out — then premultiplied by `T = S · M · N`: `N` takes NDC onto
 * `local`, `M` is `placement`, and `S` takes the clipped `frame` back to NDC. Every pixel keeps
 * its place when part of the image is clipped away, in either projection mode and under any
 * View transform — lens shift, scale and rotation all fall out of the one product. The clip
 * plane goes in after, then the view-projection and the frustum from it. Nothing here is flipped
 * for a target: that happens on the camera data's copy, so the frustum culls the volume the
 * camera actually sees.
 * @param camera - The camera whose matrices are rebuilt.
 * @param local - The rect the projection is built for.
 * @param placement - Takes `local` into the target.
 * @param frame - The rect actually rendered, in the target's pixels.
 */
function buildProjection(camera: Camera3D, local: Rectangle, placement: Matrix, frame: Rectangle): void {
  camera.view.getInverse(camera.worldTransform);
  camera.computeProjection(local.width / local.height, camera.projection);

  const { x, y, width, height } = local;
  const { a, b, c, d, tx, ty } = placement;
  const { x: fx, y: fy, width: fw, height: fh } = frame;

  // N: NDC -> local
  _tempMatrix.set(width / 2, 0, 0, x + width / 2, 0, -height / 2, 0, y + height / 2, 0, 0, 1, 0, 0, 0, 0, 1);
  // M: local -> target
  _tempMatrix2.set(a, c, 0, tx, b, d, 0, ty, 0, 0, 1, 0, 0, 0, 0, 1);
  // S: target -> NDC of the clipped frame
  _tempMatrix3.set(2 / fw, 0, 0, -(2 * fx) / fw - 1, 0, -2 / fh, 0, (2 * fy) / fh + 1, 0, 0, 1, 0, 0, 0, 0, 1);

  camera.projection.premultiply(_tempMatrix3.multiply(_tempMatrix2).multiply(_tempMatrix));

  applyClippingPlane(camera);
  camera.viewProjection.multiplyMatrices(camera.projection, camera.view);
  camera.frustum.setFromProjectionMatrix(camera.viewProjection);
}

/**
 * Updates a camera's projection for the View it draws into, through the View's world transform
 * and clipped to the screen
 *
 * The path for a camera drawing into the view's own target: its image lands somewhere on the
 * screen, so the placement is the View's world transform and the clip is the screen edge. The
 * clipped rect is written to the camera's `CameraData.frame` as well as returned: it is
 * where this camera's image lands, which the executor needs after the call has returned.
 * @param view3d - The 3D view supplying size, anchor, and world transform.
 * @param camera - The camera whose projection is rebuilt; its own `viewport` places the image.
 * @param screenBounds - The screen-space bounds of the render target.
 * @param rendererOffset - The global uniform offset (accounts for filter bounds).
 * @returns The camera's frame, or undefined if fully off-screen.
 * @internal
 */
export function updateCameraProjectionForView(
  view3d: View3D,
  camera: Camera3D,
  screenBounds: Rectangle,
  rendererOffset: PointData,
): Rectangle | undefined {
  placeCameraInView(view3d, camera, rendererOffset);

  const frame = fitFrame(_local, _placement, screenBounds, getCameraData(camera).frame);
  if (frame.width <= 0 || frame.height <= 0) return;

  buildProjection(camera, _local, _placement, frame);

  return frame;
}

/**
 * Updates a camera's projection for a texture it draws into, rather than for the screen
 *
 * The path for a camera with a render texture. There is no View transform and no screen: the
 * camera's `viewport` is a rect of the texture, placed as it stands, and clipped to the texture's
 * edge the same way a view camera is clipped to the screen's.
 *
 * Writes the rect to the camera's `CameraData.frame`, in the target's own pixels.
 * @param camera - The camera whose projection is rebuilt.
 * @param targetWidth - Width of the target, in its own pixels.
 * @param targetHeight - Height of the target, in its own pixels.
 * @returns The rect the camera's image lands in, or undefined when it lands nowhere.
 * @internal
 */
export function updateCameraProjectionForTarget(
  camera: Camera3D,
  targetWidth: number,
  targetHeight: number,
): Rectangle | undefined {
  const { x: vx, y: vy, width: vw, height: vh } = camera.viewport;

  _local.set(vx * targetWidth, vy * targetHeight, vw * targetWidth, vh * targetHeight);
  _placement.identity();
  _targetBounds.set(0, 0, targetWidth, targetHeight);

  const frame = fitFrame(_local, _placement, _targetBounds, getCameraData(camera).frame);
  if (frame.width <= 0 || frame.height <= 0) return;

  buildProjection(camera, _local, _placement, frame);

  return frame;
}

/**
 * Builds a camera's lanes and bind group for this frame
 *
 * Every camera a frame draws from comes through here once (`CameraData._currentSession`):
 * the scene update builds the view camera straight after the transform walk, then
 * `RenderGraph.prepareCameras` builds every `pass.camera` that survived `resolve` — all before
 * any render target is bound, so all read the same winding off the same binding. A camera
 * derived from the frame (a portal's) is posed by the pass that draws it, in its `condition`,
 * which runs between the transform walk and this.
 *
 * A camera with a render texture is built for that texture's frame: its size for the projection,
 * the whole of it for the screen-space UV scale, and the winding of a texture, which is never
 * root. Any other camera is built for the view's target, in the view's screen space, with the
 * view's UV scale. The view camera also fills `session.viewport` from its frame, because
 * that rect is derived from the projection this function just wrote and UV scale needs it next.
 * @param camera - The camera to prepare. Must be in `session.view3d`'s scene graph.
 * @param session - The frame's render session.
 * @internal
 */
export function prepareCamera(camera: Camera3D, session: RenderSession): void {
  const cameraData = getCameraData(camera);
  if (cameraData._currentSession === session) return;
  cameraData._currentSession = session;

  const { view3d, renderer } = session;

  // A camera has to be in the view's tree: that is what updates its world transform, and the
  // projection is built against this view's size, anchor and world transform.
  if (camera.view3d !== view3d) {
    throw new Error(
      'A render pass camera must live in the View3D it draws from. Add it to the view first, ' +
        'e.g. `view.root.addChild(camera)`.',
    );
  }

  const texture = camera.renderTexture;

  if (texture) {
    // The camera draws into a target the size of its texture's frame — a pooled render texture
    // is a frame of a larger source — so the projection is built in the frame's texels. The
    // graph binds the whole target, so screen-space UV covers all of it.
    const { frame, source } = texture;
    updateCameraProjectionForTarget(
      camera,
      Math.round(frame.width * source.resolution),
      Math.round(frame.height * source.resolution),
    );
    cameraData.setViewportUvScale(1, 1);
  } else {
    _screenBounds.x = 0;
    _screenBounds.y = 0;
    _screenBounds.width = session.defaultTarget.width;
    _screenBounds.height = session.defaultTarget.height;
    updateCameraProjectionForView(view3d, camera, _screenBounds, renderer.globalUniforms.globalUniformData.offset);

    // The view camera's frame is the session's on-screen rect. UV scale asks the pool for a
    // viewport-sized transient, so the session viewport has to exist first. Inset cameras reuse
    // that same viewport — it is a fact about the view, not about the inset.
    if (camera === view3d.camera) {
      frameToPhysicalViewport(cameraData.frame, session.defaultTarget, renderer, session.viewport);
    }

    // Viewport content occupies a sub-rect [0, vp/tex] of the pooled opaque copies; this maps the
    // [0,1] viewport UV onto it — (1,1) when the texture matches the viewport. The pool decides
    // which texture that is, so the graph asks it.
    const vp = session.viewport;
    view3d._graph.setViewportUvScale(vp.width, vp.height, _uvScale);
    cameraData.setViewportUvScale(_uvScale.x, _uvScale.y);
  }

  // The executor binds a camera's target with the outer binding's `flipY`; which way that leaves
  // the front face is pixi's to say, asked here for the target the camera will draw into before it
  // is bound. Matching that winding on the bound copy is what keeps front faces front-facing; the
  // camera's own matrices and frustum stay as built.
  const target = texture ? renderer.renderTarget.getRenderTarget(texture) : session.defaultTarget;
  const frontFaceInverted = renderer.renderTarget.isFrontFaceInverted(target, session.defaultTarget.flipY);
  const isWebGPU = renderer.type === RendererType.WEBGPU;

  // WebGPU clips z to [0, w] where GL clips to [-w, w]; the bound copy is remapped to match.
  cameraData.syncFromCamera(camera, frontFaceInverted, isWebGPU);

  // WebGPU render bundles replay without pixi's bind-group sync, so the lanes have to be on the
  // GPU before any pass records against them.
  if (isWebGPU) {
    (renderer as WebGPURenderer).ubo.updateUniformGroup(cameraData.uniformGroup);
  }
}
