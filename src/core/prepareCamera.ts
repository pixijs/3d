import { Bounds, Matrix, Point, Rectangle, RendererType } from 'pixi.js';
import type { PointData, WebGPURenderer } from 'pixi.js';

import { Matrix4 } from '../math/matrix/Matrix4';
import type { Camera3D } from '../scene/cameras/Camera3D';
import type { View3D } from '../scene/View3D';
import { getCameraData } from './CameraData';
import { cameraFrameToPhysicalViewport, frameToPhysicalViewport } from './render-graph/frameToPhysicalViewport';
import type { RenderSession } from './render-passes/RenderSession';

const _ndcToLocal = new Matrix4();
const _localToTarget = new Matrix4();
const _targetToFrame = new Matrix4();
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
 * Writes `_local`, the viewport as a rect of the View in logical pixels measured from the anchor,
 * and `_placement`, the View's world transform less the renderer's offset (nonzero inside a
 * filter, whose render target starts at the filter's bounds).
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
 *
 * `q` is the far-face corner opposite the plane, clip `(sign(nx), sign(ny), 1, 1)` taken back to
 * camera space through the inverse of a perspective projection. Scaling the plane by `s` puts that
 * corner on the new far plane, which keeps the far plane as tight as it can be. The scaled plane,
 * less the projection's W row `(0, 0, -1, 0)`, becomes the Z row. Both steps assume a perspective
 * projection whose X and Y rows don't mix, which an orthographic camera or a rotated View breaks.
 * @param camera - The camera whose projection is patched.
 */
function applyClippingPlane(camera: Camera3D): void {
  const plane = camera.clippingPlane;
  if (!plane) return;

  const e = camera.projection.elements;
  const { x: nx, y: ny, z: nz } = plane.normal;
  const nw = plane.constant;

  const qx = (Math.sign(nx) + e[8]) / e[0];
  const qy = (Math.sign(ny) + e[9]) / e[5];
  const qz = -1;
  const qw = (1 + e[10]) / e[14];

  const s = 2 / (nx * qx + ny * qy + nz * qz + nw * qw);

  e[2] = nx * s;
  e[6] = ny * s;
  e[10] = nz * s + 1;
  e[14] = nw * s;
}

/**
 * Rebuilds a camera's view and projection for the rect its image lands in
 *
 * One placement rule for every camera. The projection is built for `local`, the rect the
 * camera's `viewport` marks out, then premultiplied by `T = S · M · N`: `N` (`_ndcToLocal`) takes
 * NDC onto `local`, `M` (`_localToTarget`) is `placement`, and `S` (`_targetToFrame`) takes the
 * clipped `frame` back to NDC. Every pixel keeps its place when part of the image is clipped
 * away, in either projection mode and under any View transform: lens shift, scale and rotation
 * all fall out of the one product. The clip plane goes in after, then the view-projection and the
 * frustum from it. Nothing here is flipped for a target: that happens on the camera data's copy,
 * so the frustum culls the volume the camera actually sees.
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

  _ndcToLocal.set(width / 2, 0, 0, x + width / 2, 0, -height / 2, 0, y + height / 2, 0, 0, 1, 0, 0, 0, 0, 1);
  _localToTarget.set(a, c, 0, tx, b, d, 0, ty, 0, 0, 1, 0, 0, 0, 0, 1);
  _targetToFrame.set(2 / fw, 0, 0, -(2 * fx) / fw - 1, 0, -2 / fh, 0, (2 * fy) / fh + 1, 0, 0, 1, 0, 0, 0, 0, 1);

  camera.projection.premultiply(_targetToFrame.multiply(_localToTarget).multiply(_ndcToLocal));

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
 * CPU side only: `uploadCamera` finishes the lanes and puts them on the GPU once the lights
 * are packed. Every camera a frame draws from comes through here once (`CameraData._currentSession`):
 * the scene update builds the view camera straight after the transform walk, then
 * `RenderGraph.prepareCameras` builds every `pass.camera` that survived `resolve`. A camera
 * derived from the frame (a portal's) is posed by the pass that draws it, in its `condition`,
 * which runs between the transform walk and this.
 *
 * A camera with a render texture is built for that texture's frame, in texels, because a pooled
 * render texture is a frame of a larger source: the frame's size for the projection, and all of
 * it for the screen-space UV scale, since the graph binds the whole target. Any other camera is
 * built for the view's target, in the view's screen space, with the view's UV scale. The view
 * camera also fills `session.viewport` from its frame, because that rect is derived from the
 * projection this function just wrote and UV scale needs it next. Inset cameras reuse the view's
 * viewport for their UV scale: the pooled copies are sized to the view, not to the inset.
 *
 * On WebGPU the light tile grid is fitted here and uploads with the rest of the camera; WebGL
 * fits it to the live viewport at each forward draw.
 *
 * The executor binds a camera's target with the outer binding's `flipY`, and pixi's
 * `isFrontFaceInverted` says which way that leaves the front face. This asks for the target the
 * camera will draw into before any target is bound, so every camera reads the same binding; a
 * texture's target is never root. The bound copy of the projection matches that winding, which
 * keeps front faces front-facing. The camera's own matrices and frustum stay as built.
 * @param camera - The camera to prepare. Throws unless it is in `session.view3d`'s scene graph:
 *   the view's transform walk is what updates its world transform, and the projection is built
 *   against the view's size, anchor and world transform.
 * @param session - The frame's render session.
 * @internal
 */
export function prepareCamera(camera: Camera3D, session: RenderSession): void {
  const cameraData = getCameraData(camera);
  if (cameraData._currentSession === session) return;
  cameraData._currentSession = session;

  const { view3d, renderer } = session;

  if (camera.view3d !== view3d) {
    throw new Error(
      'A render pass camera must live in the View3D it draws from. Add it to the view first, ' +
        'e.g. `view.root.addChild(camera)`.',
    );
  }

  const isWebGPU = renderer.type === RendererType.WEBGPU;
  const texture = camera.renderTexture;

  if (texture) {
    const { frame, source } = texture;
    const targetWidth = Math.round(frame.width * source.resolution);
    const targetHeight = Math.round(frame.height * source.resolution);
    updateCameraProjectionForTarget(camera, targetWidth, targetHeight);
    cameraData.setViewportUvScale(1, 1);
    _targetBounds.set(0, 0, targetWidth, targetHeight);
  } else {
    _screenBounds.x = 0;
    _screenBounds.y = 0;
    _screenBounds.width = session.defaultTarget.width;
    _screenBounds.height = session.defaultTarget.height;
    updateCameraProjectionForView(view3d, camera, _screenBounds, renderer.globalUniforms.globalUniformData.offset);

    if (camera === view3d.camera) {
      frameToPhysicalViewport(cameraData.frame, session.defaultTarget, renderer, session.viewport);
    }

    const vp = session.viewport;
    view3d._graph.setViewportUvScale(vp.width, vp.height, _uvScale);
    cameraData.setViewportUvScale(_uvScale.x, _uvScale.y);
  }

  if (isWebGPU) {
    const bounds = texture ? _targetBounds : view3d._graph.sceneViewport(session, _targetBounds);
    const viewport = camera === view3d.camera ? bounds : cameraFrameToPhysicalViewport(camera, session, bounds);
    if (viewport) cameraData.setViewport(viewport, true);
  }

  const target = texture ? renderer.renderTarget.getRenderTarget(texture) : session.defaultTarget;
  const frontFaceInverted = renderer.renderTarget.isFrontFaceInverted(target, session.defaultTarget.flipY);

  cameraData.syncFromCamera(camera, frontFaceInverted, isWebGPU);
}

/**
 * Finishes a prepared camera's lanes once a frame, and on WebGPU uploads them
 *
 * This step bins the view's packed lights into this camera's tile and depth masks. The scene update
 * builds the view camera before packing the lights because shadow fitting needs the camera.
 * `RenderGraph.prepareCameras` runs this step after the lights are settled and before any pass draws.
 *
 * WebGL syncs a dirty uniform group at the next draw. WebGPU render bundles replay without
 * pixi's bind-group sync, so on WebGPU this writes the lanes to the GPU before any pass
 * records against them.
 * @param camera - A camera `prepareCamera` has built this frame.
 * @param session - The frame's render session, with the view's lights packed.
 * @internal
 */
export function uploadCamera(camera: Camera3D, session: RenderSession): void {
  const cameraData = getCameraData(camera);
  cameraData.prepareLightTiles(session);

  const { renderer } = session;
  if (renderer.type === RendererType.WEBGPU) {
    (renderer as WebGPURenderer).ubo.updateUniformGroup(cameraData.uniformGroup);
  }
}
