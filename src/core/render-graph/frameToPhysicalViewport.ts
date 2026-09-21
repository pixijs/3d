import { Rectangle, RendererType } from 'pixi.js';
import type { Renderer, RenderTarget } from 'pixi.js';

import type { Camera3D } from '../../scene/cameras/Camera3D';
import { getCameraData } from '../CameraData';
import type { ReadonlyRect, RenderSession } from '../render-passes/RenderSession';

const _tempRect = new Rectangle();

/** Bounds handed to `placeViewport` for a whole render target */
const _sourceBounds = { x: 0, y: 0, width: 0, height: 0 };

/**
 * Rounds a pixel coordinate the way pixi rounds one
 *
 * Adding a half and truncating is pixi's own idiom in `RenderTargetSystem.bind()`. It is not
 * `Math.round`: truncation goes toward zero, so -1.2 lands on 0 here and on -1 there. That case
 * is real — a view scrolled off the left or top edge has a negative frame — and a viewport one
 * pixel out of step with the bind that set it shows up as a seam.
 * @param value - The coordinate, in fractional pixels.
 * @returns The coordinate as a whole number of pixels.
 */
function roundLikePixi(value: number): number {
  return (value + 0.5) | 0;
}

/**
 * Places a logical rect as a GPU viewport inside `bounds`
 *
 * Shared by both callers below, which differ only in what they measure against: a whole render
 * target, or the content rect a camera's image is placed inside. The rect is scaled into
 * physical pixels, shifted so `origin` becomes zero, rounded, then trimmed to fit — a viewport
 * running past its bounds is clamped rather than dropped, and never shrinks below one pixel.
 * @param frame - The rect to place, in logical pixels.
 * @param scale - Logical pixels to physical pixels.
 * @param originX - Logical x that maps to the left edge of `bounds`.
 * @param originY - Logical y that maps to the top edge of `bounds`.
 * @param bounds - The region to place inside, in physical pixels.
 * @param flipY - Measure y up from the bottom of `bounds` instead of down from the top.
 * @param out - Receives the viewport.
 * @returns `out`, for inline use.
 */
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

  // A negative corner means the rect starts outside: pull it to the edge and take the overhang
  // off the size, so what is left is the part that was inside all along.
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
 * Convert a logical-pixel rect to a physical-pixel viewport for `target`, matching the
 * rounding/clamping that Pixi's `RenderTargetSystem.bind()` performs when given a `frame`
 *
 * We replicate the math here so we can call `setViewport` directly — going through `bind()`
 * would close and reopen the WebGPU pass encoder.
 *
 * WebGL's framebuffer has a bottom-left origin, so when rendering to the
 * root the y must be flipped relative to the texture height. WebGPU and
 * WebGL FBOs both use top-left origin, no flip. Pixi's GL adaptor does the
 * same flip inside `startRenderPass`; `setViewport` does not, so we apply
 * it here.
 * @param frame - The logical-pixel rect to convert.
 * @param target - The render target the viewport applies to.
 * @param renderer - The active renderer (drives the WebGL root Y-flip).
 * @param out - Receives the physical-pixel viewport.
 * @returns `out`, for inline use.
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
 * The GPU viewport of a pass drawing from `camera`, inside the target's content rect
 *
 * A texture camera's frame is already in its texture's pixels. A view-space camera's is in
 * the view's screen space, so it is shifted by the view frame's origin and scaled to the
 * target's resolution. Rounded the way pixi's bind rounds, clamped so the pass never draws
 * outside the bound content. On WebGL to the root canvas, the view's image is bottom-up, so
 * a view-space rect flips within the frame — the same flip `frameToPhysicalViewport`
 * applies. A texture camera's image is never bottom-up.
 * @param camera - The pass's camera.
 * @param session - The frame's render session.
 * @param bounds - The target content the camera's image is placed inside, in physical pixels.
 * @returns The viewport, or `null` when the camera lands nowhere.
 * @internal
 */
export function cameraFrameToPhysicalViewport(
  camera: Camera3D,
  session: RenderSession,
  bounds: ReadonlyRect,
): Rectangle | null {
  const frame = getCameraData(camera).frame;
  if (frame.width <= 0 || frame.height <= 0) return null;

  const inTexture = camera.renderTexture !== null;
  const scale = inTexture ? 1 : session.defaultTarget.colorTexture.source.resolution;
  const viewFrame = getCameraData(session.view3d.camera).frame;
  const originX = inTexture ? 0 : viewFrame.x;
  const originY = inTexture ? 0 : viewFrame.y;
  const flipY = !inTexture && session.renderer.type === RendererType.WEBGL && session.defaultTarget.isRoot;

  return placeViewport(frame, scale, originX, originY, bounds, flipY, _tempRect);
}
