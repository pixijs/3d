import { Rectangle, RendererType } from 'pixi.js';
import type { Renderer, RenderTarget } from 'pixi.js';

import type { Camera3D } from '../../scene/cameras/Camera3D';
import { getCameraData } from '../CameraData';
import type { ReadonlyRect, RenderSession } from '../render-passes/RenderSession';

const _tempRect = new Rectangle();

const _sourceBounds = { x: 0, y: 0, width: 0, height: 0 };

/**
 * Pixi's rounding in `RenderTargetSystem.bind()`, which truncates toward zero; `Math.round` differs on
 * the negative frame of a view scrolled off the left or top edge, and leaves a one-pixel seam
 */
function roundLikePixi(value: number): number {
  return (value + 0.5) | 0;
}

function placeViewport(
  frame: Rectangle,
  scale: number,
  originX: number,
  originY: number,
  bounds: ReadonlyRect,
  flipY: boolean,
  out: Rectangle,
): Rectangle {
  let x = roundLikePixi((frame.x - originX) * scale);
  let y = roundLikePixi((frame.y - originY) * scale);
  let w = roundLikePixi(frame.width * scale);
  let h = roundLikePixi(frame.height * scale);

  if (x < 0) {
    w += x;
    x = 0;
  }
  if (y < 0) {
    h += y;
    y = 0;
  }
  if (x > bounds.width - 1) x = bounds.width - 1;
  if (y > bounds.height - 1) y = bounds.height - 1;
  if (w > bounds.width - x) w = bounds.width - x;
  if (h > bounds.height - y) h = bounds.height - y;
  if (w < 1) w = 1;
  if (h < 1) h = 1;

  if (flipY) y = bounds.height - h - y;

  out.x = bounds.x + x;
  out.y = bounds.y + y;
  out.width = w;
  out.height = h;
  return out;
}

/**
 * Matches pixi's `RenderTargetSystem.bind()` viewport, so the graph can narrow with `setViewport` and skip a rebind,
 * which on WebGPU ends the render pass; adds the WebGL canvas's y flip, which a bind applies and `setViewport` skips
 * @param frame - In logical pixels.
 * @param target - The target the viewport applies to.
 * @param renderer - The renderer.
 * @param out - Receives the viewport, in physical pixels.
 * @internal
 */
export function frameToPhysicalViewport(
  frame: Rectangle,
  target: RenderTarget,
  renderer: Renderer,
  out: Rectangle,
): Rectangle {
  const source = target.colorTexture.source;

  _sourceBounds.width = source.pixelWidth;
  _sourceBounds.height = source.pixelHeight;

  const flipY = renderer.type === RendererType.WEBGL && target.isRoot;

  return placeViewport(frame, source.resolution, 0, 0, _sourceBounds, flipY, out);
}

/**
 * `null` when the camera's frame is empty; flips y on the WebGL canvas as `frameToPhysicalViewport` does
 * @param camera - The pass's camera.
 * @param session - The frame's render session.
 * @param bounds - The target's content rect, in its texels.
 * @param sceneResolution - `RenderGraph.resolution`.
 * @internal
 */
export function cameraFrameToPhysicalViewport(
  camera: Camera3D,
  session: RenderSession,
  bounds: ReadonlyRect,
  sceneResolution: number,
): Rectangle | null {
  const frame = getCameraData(camera).frame;
  if (frame.width <= 0 || frame.height <= 0) return null;

  const inTexture = camera.renderTexture !== null;
  const scale = inTexture ? 1 : sceneResolution;
  const viewFrame = getCameraData(session.view3d.camera).frame;
  const originX = inTexture ? 0 : viewFrame.x;
  const originY = inTexture ? 0 : viewFrame.y;
  const flipY = !inTexture && session.renderer.type === RendererType.WEBGL && session.defaultTarget.isRoot;

  return placeViewport(frame, scale, originX, originY, bounds, flipY, _tempRect);
}
