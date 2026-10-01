import { BindGroup, Point, Rectangle, UniformGroup } from 'pixi.js';

import { Matrix4 } from '../math/matrix/Matrix4';
import { Frustum } from '../math/misc/Frustum';
import { Vector3 } from '../math/vector/Vector3';
import type { Camera3D } from '../scene/cameras/Camera3D';
import { LIGHT_DEPTH_LANES, LIGHT_TILE_LANES, LightTiles } from './LightTiles';
import type { ReadonlyRect, RenderSession } from './render-passes/RenderSession';

/** Eye extracted from a camera's world transform; never escapes this module */
const scratchCameraPosition = new Vector3();

/**
 * Negates a projection's Y row in place
 *
 * Pixi inverts the front face for some bindings (`isFrontFaceInverted`: a WebGL framebuffer or a
 * `flipY` binding, but not both); a draw into one needs its projection's Y to match, or front
 * faces cull as back faces. Only the copy bound to the GPU is ever flipped; a camera's own
 * matrices stay as built.
 * @param projection - The matrix to flip.
 */
function flipProjectionY(projection: Matrix4): void {
  const e = projection.elements;
  e[1] = -e[1];
  e[5] = -e[5];
  e[9] = -e[9];
  e[13] = -e[13];
}

/**
 * Remaps a projection's clip z from GL's `[-w, w]` to WebGPU's `[0, w]` in place, `(z + w) / 2`
 *
 * `Camera3D` builds every projection in the GL convention. WebGPU discards clip z below zero, so
 * without this the nearer half of the range is lost: a sliver past the near plane for a
 * perspective camera, half the depth for an orthographic one, and the whole slab behind an
 * oblique clip plane, which the construction puts exactly at `-w`. Applied to the bound copy
 * only, after the clip plane, so the plane lands on WebGPU's near face and the camera's own
 * matrices stay as built. What the depth buffer then stores is the same `(z + 1) / 2` GL stores,
 * so depth readers share one formula.
 * @param projection - The matrix to remap.
 */
function remapProjectionZeroToOne(projection: Matrix4): void {
  const e = projection.elements;
  e[2] = 0.5 * (e[2] + e[3]);
  e[6] = 0.5 * (e[6] + e[7]);
  e[10] = 0.5 * (e[10] + e[11]);
  e[14] = 0.5 * (e[14] + e[15]);
}

/**
 * Somewhere a pass draws from: a position, a view, a projection, and the frustum to cull against
 *
 * This is what a render pass actually needs from a camera. A {@link Camera3D} owns one, and so
 * does a shadow cascade, which is why it exists as its own thing rather than as fields on the
 * camera. A cascade's projection is an off-centre, texel-snapped box built to stop shadow edges
 * crawling, and its view comes from the light-space fit rather than a node transform, so it can't
 * be a `Camera3D` without pushing shadow vocabulary into the public camera API.
 *
 * The matrices here *are* the uniform lanes: the uniform group holds these same objects, so this
 * is the single home for camera data, GPU side and CPU side both.
 * @internal
 */
export class CameraData {
  /** The camera lanes, written by `CameraData.set` */
  public readonly uniformGroup: UniformGroup;
  /** Bound at group 1 by every draw from this camera data; bundles bake it */
  public readonly bindGroup: BindGroup;
  /** Eye position in world space, the `uCameraPosition` lane */
  public readonly position = new Vector3();
  /** World-to-view, the `uViewMatrix` lane */
  public readonly view = new Matrix4();
  /**
   * View-to-clip, the `uProjectionMatrix` lane: Y-flipped when the bound target's winding is,
   * and on WebGPU with clip z remapped to `[0, w]`
   */
  public readonly projection = new Matrix4();
  /** `projection × view`, the `uViewProjectionMatrix` lane, and what the draws transform by */
  public readonly viewProjection = new Matrix4();
  /**
   * Content rect over texture size, the `uViewportUVScale` lane
   *
   * Maps `[0, 1]` screen UV onto the sub-rect this camera's image actually occupies in the
   * texture it was drawn into. `(1, 1)` when the image fills the texture; smaller when the
   * pool rounded the texture up to a power-of-two bucket, which is what every screen-space
   * sampler (transmission, refraction, the post chain's reads) multiplies through. It lives
   * with the camera because it is a fact about the camera's target.
   */
  public readonly viewportUvScale = new Point(1, 1);
  /** Screen-tile masks, depth masks and the lanes that index them, uploaded with this camera's uniforms */
  public readonly lightTiles = new LightTiles();
  /**
   * The volume to cull against, written by this camera data's owner
   *
   * Deliberately not derived from `CameraData.viewProjection`, which may carry the bound
   * target's Y flip: the viewport lens shift makes a projection asymmetric, and a flipped frustum
   * would cull the wrong half. A `Camera3D` builds it from its own, unflipped matrices. A cascade
   * has no flip, so for one this is the same matrix the draws use.
   */
  public readonly frustum: Frustum;

  /**
   * The rect this camera's image lands in, already clipped to its target
   *
   * *Frame* is pixi's word for the rect a bind narrows to. Written from `camera.viewport` by
   * `updateCameraProjectionForView` (logical pixels, through the View's transform, clipped to the
   * screen) or, for a camera with a render texture, by `updateCameraProjectionForTarget` (the
   * texture's own pixels). Empty (zero width or height) when the camera lands nowhere. The view
   * camera's is what the executor binds the whole view at; a pass camera's is the sub-rect the
   * executor narrows that pass's GPU viewport to.
   */
  public readonly frame = new Rectangle();

  /**
   * The session this data was last built for, or `null`
   *
   * `prepareCamera` builds a camera once per frame however many passes name it. Sessions are
   * minted fresh each frame, so identity is the whole check.
   */
  public _currentSession: RenderSession | null = null;

  /**
   * @param frustum - Cull volume to adopt. Pass the owner's existing one (a `Camera3D` has a
   *   public `frustum`), so there is only ever one. Omitted, this allocates its own.
   */
  constructor(frustum: Frustum = new Frustum()) {
    this.frustum = frustum;
    this.uniformGroup = new UniformGroup({
      uCameraPosition: { value: this.position, type: 'vec3<f32>' },
      uViewMatrix: { value: this.view, type: 'mat4x4<f32>' },
      uProjectionMatrix: { value: this.projection, type: 'mat4x4<f32>' },
      uViewProjectionMatrix: { value: this.viewProjection, type: 'mat4x4<f32>' },
      uViewportUVScale: { value: this.viewportUvScale, type: 'vec2<f32>' },
      uLightTileTransform: { value: this.lightTiles.tileTransform, type: 'vec4<f32>' },
      uLightTiles: { value: this.lightTiles.masks, type: 'vec4<i32>', size: LIGHT_TILE_LANES },
      uLightDepthMasks: { value: this.lightTiles.depthMasks, type: 'vec4<i32>', size: LIGHT_DEPTH_LANES },
      uLightDepthPlane: { value: this.lightTiles.depthPlane, type: 'vec4<f32>' },
    });
    this.uniformGroup.isStatic = true;
    this.uniformGroup.ubo = false;
    this.bindGroup = new BindGroup({ 0: this.uniformGroup });
  }

  /**
   * Writes the lanes and marks them for upload
   *
   * Takes copies, so a caller is free to reuse the matrices it passes, as the light's per-cascade
   * scratch does. The flip, when asked for, is applied to the copy, so the caller's projection is
   * never changed under it. The view-projection is the product, formed
   * here so nothing downstream can read one that disagrees with its own parts. The frustum is
   * left alone; see `CameraData.frustum` for why it isn't derived from the same matrices.
   * @param position - Eye position in world space.
   * @param view - World-to-view matrix.
   * @param projection - View-to-clip matrix, as built, in the GL convention.
   * @param flipY - Whether the target these lanes draw into has its front face inverted.
   * @param zeroToOneDepth - Whether the backend clips z to `[0, w]` (WebGPU); the copy is remapped to it.
   * @returns This camera data, for chaining.
   */
  public set(position: Vector3, view: Matrix4, projection: Matrix4, flipY = false, zeroToOneDepth = false): this {
    this.position.copyFrom(position);
    this.view.copyFrom(view);
    this.projection.copyFrom(projection);
    if (flipY) flipProjectionY(this.projection);
    if (zeroToOneDepth) remapProjectionZeroToOne(this.projection);
    this.viewProjection.multiplyMatrices(this.projection, view);
    this.lightTiles.invalidate();
    this.uniformGroup.update();

    return this;
  }

  /**
   * Writes the sub-rect this camera's image occupies in the texture it lands in
   * @param x - Content width over texture width.
   * @param y - Content height over texture height.
   * @returns This camera data, for chaining.
   */
  public setViewportUvScale(x: number, y: number): this {
    this.viewportUvScale.set(x, y);
    this.uniformGroup.update();

    return this;
  }

  /**
   * Fits the light tile grid to the GPU viewport and marks it for upload when the fit changes
   *
   * Each WebGL forward draw passes the live pass viewport after the graph binds the target and
   * applies the camera's frame. WebGPU passes the camera target's viewport during preparation,
   * before uploading the uniform buffer.
   * @param rect - The GPU viewport, in the target's physical pixels.
   * @param topDown - Whether pixel rows count down from the top of the target (WebGPU).
   * @returns This camera data, for chaining.
   */
  public setViewport(rect: ReadonlyRect, topDown = false): this {
    if (this.lightTiles.setViewport(rect, topDown)) this.uniformGroup.update();

    return this;
  }

  /**
   * Prepares this camera's light tile and depth masks and marks them for upload after binning
   *
   * See `LightTiles.prepare` for the binning and caching rules.
   * @param session - The frame's render session, with the view's lights packed.
   */
  public prepareLightTiles(session: RenderSession): void {
    if (this.lightTiles.prepare(session, this.viewProjection, this.view)) this.uniformGroup.update();
  }

  /**
   * Writes this camera's own lanes in
   *
   * Extracts the eye from the world transform and copies `view` / `projection`, flipping the
   * copy for the target when asked. The camera's matrices are left as built.
   * @param camera - The camera to read from.
   * @param flipY - Whether the target this camera draws into has its front face inverted.
   * @param zeroToOneDepth - Whether the backend clips z to `[0, w]` (WebGPU).
   * @returns This camera data, for chaining.
   */
  public syncFromCamera(camera: Camera3D, flipY = false, zeroToOneDepth = false): this {
    camera.worldTransform.extractPosition(scratchCameraPosition);

    return this.set(scratchCameraPosition, camera.view, camera.projection, flipY, zeroToOneDepth);
  }

  /**
   * Frees the GPU side: the bind group, then the uniform buffer under it
   *
   * The bind group goes first so what it binds reacts to the change before the buffer dies. The
   * `UniformGroup` itself is renderer-managed and never destroyed; its buffer is this data's, and
   * a shadow cascade's is exempt from the renderer GC, so nothing else would ever reclaim it.
   * Called when the owner dies: a camera's `destroy`, a light's cascade release.
   */
  public destroy(): void {
    this.lightTiles.destroy();
    this._currentSession = null;
    this.bindGroup.destroy();
    this.uniformGroup.buffer?.destroy();
  }
}

/**
 * A camera's data, created on first use and kept on the camera
 *
 * One per camera, shared by every pass drawing from it; it adopts the camera's own `frustum`.
 * Created lazily: a camera that never renders never allocates a uniform group or a bind group.
 * @param camera - The camera whose data to fetch.
 * @returns The camera's data.
 * @internal
 */
export function getCameraData(camera: Camera3D): CameraData {
  return (camera._cameraData ??= new CameraData(camera.frustum));
}
