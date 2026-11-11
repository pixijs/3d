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
const _uvScale = new Point();
const _local = new Rectangle();
const _placement = new Matrix();
const _bounds = new Bounds();

function placeCameraInView(view3d: View3D, camera: Camera3D, rendererOffset: PointData): void {
  const { width, height } = view3d;
  const { x: ax, y: ay } = view3d.anchor;
  const { x: vx, y: vy, width: vw, height: vh } = camera.viewport;

  _local.set((vx - ax) * width, (vy - ay) * height, vw * width, vh * height);

  _placement.copyFrom(view3d.worldTransform);
  _placement.tx -= rendererOffset.x;
  _placement.ty -= rendererOffset.y;
}

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
 * Makes the camera's `clippingPlane` its near plane (Lengyel's oblique frustum), in GL clip space; assumes a
 * perspective projection whose X and Y rows don't mix, which an orthographic camera or a rotated View breaks
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
 * Builds a camera's matrices for `local`, then maps them onto the clipped `frame` so no pixel moves when clipped;
 * they stay unflipped, as the frustum needs, and `CameraData` flips its GPU copy
 * @param camera - The camera whose matrices are rebuilt.
 * @param local - The rect the camera's `viewport` marks out.
 * @param placement - Takes `local` into the target.
 * @param frame - The clipped rect drawn, in the target's pixels.
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
 * Rebuilds a camera's matrices for its place on the view's target; returns its frame, or `undefined` off-screen
 * @param view3d - The view.
 * @param camera - The camera.
 * @param screenBounds - The target's bounds.
 * @param rendererOffset - The renderer's global offset, nonzero inside a filter.
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
 * Rebuilds a camera's matrices for its render texture; returns its frame in texels, or `undefined` if it lands nowhere
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
 * Builds a camera's matrices and CPU-side lanes, once per session however many passes name it. The view camera
 * must go first: it fills the `session.viewport` that `sceneViewport` reads. Any other camera drawing into the
 * view takes the view's UV scale, since the pooled textures it samples are sized to the scene.
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

    view3d._graph.sceneViewport(session, _targetBounds);
    view3d._graph.setViewportUvScale(_targetBounds.width, _targetBounds.height, _uvScale);
    cameraData.setViewportUvScale(_uvScale.x, _uvScale.y);
  }

  const viewport =
    camera === view3d.camera
      ? _targetBounds
      : cameraFrameToPhysicalViewport(camera, session, _targetBounds, view3d._graph.resolution);

  if (isWebGPU && viewport) cameraData.setViewport(viewport, true);

  const target = texture ? renderer.renderTarget.getRenderTarget(texture) : session.defaultTarget;
  const frontFaceInverted = renderer.renderTarget.isFrontFaceInverted(target, session.defaultTarget.flipY);

  cameraData.syncFromCamera(camera, frontFaceInverted, isWebGPU, viewport);
}

/**
 * Bins the packed lights into a prepared camera's tiles, then on WebGPU uploads its uniforms, which bundles don't
 * sync; separate from `prepareCamera` because the view camera is built before the lights are packed
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
