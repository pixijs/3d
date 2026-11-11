import { BindGroup, Point, Rectangle, UniformGroup } from 'pixi.js';
import type { PointData } from 'pixi.js';

import { Matrix4 } from '../math/matrix/Matrix4';
import { Frustum } from '../math/misc/Frustum';
import { Vector3 } from '../math/vector/Vector3';
import type { Camera3D } from '../scene/cameras/Camera3D';
import { LIGHT_DEPTH_LANES, LIGHT_TILE_LANES, LightTiles } from './LightTiles';
import type { ReadonlyRect, RenderSession } from './render-passes/RenderSession';

const scratchCameraPosition = new Vector3();
const scratchJitter = new Point();
const NO_JITTER: PointData = { x: 0, y: 0 };

function flipProjectionY(projection: Matrix4): void {
  const e = projection.elements;
  e[1] = -e[1];
  e[5] = -e[5];
  e[9] = -e[9];
  e[13] = -e[13];
}

function jitterProjection(projection: Matrix4, x: number, y: number): void {
  const e = projection.elements;
  e[0] += x * e[3];
  e[4] += x * e[7];
  e[8] += x * e[11];
  e[12] += x * e[15];
  e[1] += y * e[3];
  e[5] += y * e[7];
  e[9] += y * e[11];
  e[13] += y * e[15];
}

/** `linearDepth` in `fxhBit` relies on this storing depth as `(ndc + 1) / 2`, as WebGL does */
function remapProjectionZeroToOne(projection: Matrix4): void {
  const e = projection.elements;
  e[2] = 0.5 * (e[2] + e[3]);
  e[6] = 0.5 * (e[6] + e[7]);
  e[10] = 0.5 * (e[10] + e[11]);
  e[14] = 0.5 * (e[14] + e[15]);
}

/**
 * Turns a GL-convention matrix into the GPU's: jitter, then Y flip, so the jitter keeps its direction on screen,
 * then depth remap; all are row operations, so a view-projection works as well as a projection
 * @param matrix - A projection or view-projection, edited in place.
 * @param jitter - NDC offset, Y up.
 * @param flipY - Whether the target's front face is inverted.
 * @param zeroToOneDepth - Whether to remap clip z to `[0, w]`, for WebGPU.
 */
function toGpuMatrix(matrix: Matrix4, jitter: PointData, flipY: boolean, zeroToOneDepth: boolean): void {
  jitterProjection(matrix, jitter.x, jitter.y);
  if (flipY) flipProjectionY(matrix);
  if (zeroToOneDepth) remapProjectionZeroToOne(matrix);
}

/** @internal */
export class CameraData {
  /** Fields and order must match `cameraBit` */
  public readonly uniformGroup: UniformGroup;
  public readonly bindGroup: BindGroup;
  public readonly position = new Vector3();
  public readonly view = new Matrix4();
  /** The GPU form `set` builds, jittered, Y-flipped and depth-remapped as asked, unlike the camera's own */
  public readonly projection = new Matrix4();
  public readonly viewProjection = new Matrix4();
  /**
   * The camera's view-projection at its last render, in this render's GPU form, jitter included, so the jitter
   * cancels out of the motion a shader measures
   */
  public readonly previousViewProjection = new Matrix4();
  public readonly viewportUvScale = new Point(1, 1);
  public readonly lightTiles = new LightTiles();
  /**
   * Built from unflipped matrices, as `buildProjection` in `prepareCamera.ts` builds a camera's, since a Y flip
   * on a lens-shifted projection would mirror the volume
   */
  public readonly frustum: Frustum;

  /**
   * Where the camera's image lands, clipped to its target, in logical pixels on screen or texels in a render
   * texture; empty when it lands nowhere
   */
  public readonly frame = new Rectangle();

  /** The session this was last built for; identity is enough, since each frame makes a new session */
  public _currentSession: RenderSession | null = null;

  /** `Camera3D.viewProjection` at the last render, as built, so `syncFromCamera` can give it this render's GPU form */
  private readonly _lastViewProjection = new Matrix4();
  /** Whether `_lastViewProjection` holds an earlier render */
  public _hasHistory = false;

  constructor(frustum: Frustum = new Frustum()) {
    this.frustum = frustum;
    this.uniformGroup = new UniformGroup({
      uCameraPosition: { value: this.position, type: 'vec3<f32>' },
      uViewMatrix: { value: this.view, type: 'mat4x4<f32>' },
      uProjectionMatrix: { value: this.projection, type: 'mat4x4<f32>' },
      uViewProjectionMatrix: { value: this.viewProjection, type: 'mat4x4<f32>' },
      uPreviousViewProjectionMatrix: { value: this.previousViewProjection, type: 'mat4x4<f32>' },
      uViewportUVScale: { value: this.viewportUvScale, type: 'vec2<f32>' },
      uLightTileTransform: { value: this.lightTiles.tileTransform, type: 'vec4<f32>' },
      uLightTiles: { value: this.lightTiles.masks, type: 'vec4<i32>', size: LIGHT_TILE_LANES },
      uLightDepthMasks: { value: this.lightTiles.depthMasks, type: 'vec4<i32>', size: LIGHT_DEPTH_LANES },
      uLightDepthPlane: { value: this.lightTiles.depthPlane, type: 'vec4<f32>' },
    });
    this.uniformGroup.isStatic = true;
    this.uniformGroup.ubo = false;
    this.bindGroup = new BindGroup({ camera: this.uniformGroup });
  }

  /**
   * Writes the lanes from copies, so callers may pass scratch matrices, and builds the projection's GPU form
   * @param position - Eye position in world space.
   * @param view - World to view.
   * @param projection - As built, in the GL convention.
   * @param flipY - Whether the target's front face is inverted.
   * @param zeroToOneDepth - Whether to remap clip z to `[0, w]`, for WebGPU.
   * @param jitter - In NDC with Y up, not the pixels `Camera3D.jitter` holds.
   */
  public set(
    position: Vector3,
    view: Matrix4,
    projection: Matrix4,
    flipY = false,
    zeroToOneDepth = false,
    jitter: PointData = NO_JITTER,
  ): this {
    this.position.copyFrom(position);
    this.view.copyFrom(view);
    this.projection.copyFrom(projection);
    toGpuMatrix(this.projection, jitter, flipY, zeroToOneDepth);
    this.viewProjection.multiplyMatrices(this.projection, view);
    this.lightTiles.invalidate();
    this.uniformGroup.update();

    return this;
  }

  public setViewportUvScale(x: number, y: number): this {
    this.viewportUvScale.set(x, y);
    this.uniformGroup.update();

    return this;
  }

  public setViewport(rect: ReadonlyRect, topDown = false): this {
    if (this.lightTiles.setViewport(rect, topDown)) this.uniformGroup.update();

    return this;
  }

  public prepareLightTiles(session: RenderSession): void {
    if (this.lightTiles.prepare(session, this.viewProjection, this.view)) this.uniformGroup.update();
  }

  /**
   * Writes the camera's lanes and rolls `previousViewProjection` forward; a camera drawn twice in one frame reads
   * no motion the second time
   * @param camera - The camera, with its matrices built for this render.
   * @param flipY - Whether the target's front face is inverted.
   * @param zeroToOneDepth - Whether to remap clip z to `[0, w]`, for WebGPU.
   * @param viewport - The GPU viewport, which turns the camera's pixel jitter into NDC; no jitter without one.
   */
  public syncFromCamera(camera: Camera3D, flipY = false, zeroToOneDepth = false, viewport?: ReadonlyRect | null): this {
    camera.worldTransform.extractPosition(scratchCameraPosition);

    const { x, y } = camera.jitter;
    const valid = viewport && viewport.width > 0 && viewport.height > 0;
    scratchJitter.set(valid ? (2 * x) / viewport.width : 0, valid ? (-2 * y) / viewport.height : 0);

    this.set(scratchCameraPosition, camera.view, camera.projection, flipY, zeroToOneDepth, scratchJitter);

    const previous = this.previousViewProjection;
    previous.copyFrom(this._hasHistory ? this._lastViewProjection : camera.viewProjection);
    toGpuMatrix(previous, scratchJitter, flipY, zeroToOneDepth);
    this._lastViewProjection.copyFrom(camera.viewProjection);
    this._hasHistory = true;

    return this;
  }

  /**
   * Destroys the bind group before the buffer it binds; nothing else frees a cascade's buffer, which
   * `ShadowRenderPassGpu` takes out of the renderer GC
   */
  public destroy(): void {
    this.lightTiles.destroy();
    this._currentSession = null;
    this.bindGroup.destroy();
    this.uniformGroup.buffer?.destroy();
  }
}

/**
 * A camera's data, made on first use and sharing the camera's `frustum`
 * @internal
 */
export function getCameraData(camera: Camera3D): CameraData {
  return (camera._cameraData ??= new CameraData(camera.frustum));
}
