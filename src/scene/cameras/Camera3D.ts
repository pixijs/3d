import { definedProps, Rectangle } from 'pixi.js';
import type { RenderTexture } from 'pixi.js';

import type { CameraData } from '../../core/CameraData';
import { Matrix4 } from '../../math/matrix/Matrix4';
import { Frustum } from '../../math/misc/Frustum';
import type { Plane } from '../../math/shapes/Plane';
import type { Destroy3DOptions } from '../../utils/Destroy3DOptions';
import { Container3D } from '../Container3D';
import type { Container3DOptions } from '../Container3D';

/**
 * Projection mode for a {@link Camera3D}
 *
 * - `'perspective'` — pinhole projection with vertical field-of-view (`fov`).
 * - `'orthographic'` — parallel projection sized by `orthographicSize` (half-width in world units).
 * @see {@link Camera3D#mode}
 * @category scene
 * @standard
 */
export type CameraMode = 'perspective' | 'orthographic';

/**
 * Constructor options for {@link Camera3D}
 *
 * Every field has a default; pass only what you need. Inherited {@link Container3DOptions}
 * (`label`, `position`, `eventMode`, …) are applied too.
 * @example
 * ```ts
 * const camera = new Camera3D({
 *   mode: 'perspective',
 *   fov: 45,
 *   near: 0.1,
 *   far: 500,
 *   label: 'mainCamera',
 * });
 * ```
 * @see {@link Camera3D} For the constructed camera and runtime accessors.
 * @category scene
 * @standard
 */
export interface Camera3DOptions extends Container3DOptions {
  /**
   * Projection mode
   * @default 'perspective'
   */
  mode?: CameraMode;
  /**
   * Vertical field of view in degrees (perspective only)
   * @default 60
   */
  fov?: number;
  /**
   * Multiplicative zoom factor
   *
   * For perspective it divides `fov`; for orthographic it scales `orthographicSize`.
   * @default 1
   */
  zoom?: number;
  /**
   * Near clipping plane distance, in world units
   * @default 0.1
   */
  near?: number;
  /**
   * Far clipping plane distance, in world units
   * @default 1000
   */
  far?: number;
  /**
   * Half-width of the orthographic frustum in world units when `zoom = 1`
   * (orthographic only)
   * @default 5
   */
  orthographicSize?: number;
  /**
   * Optional oblique clipping plane
   *
   * The projection matrix is patched so everything on the negative side of the plane
   * (in camera space) is clipped. `null` disables clipping.
   * @default null
   */
  clippingPlane?: Plane | null;
  /**
   * Texture this camera's image lands in when a pass draws from it — see
   * {@link Camera3D#renderTexture}
   * @default null
   */
  renderTexture?: RenderTexture | null;
}

/**
 * The scene camera — a {@link Container3D} whose world transform drives the view matrix
 *
 * The paired {@link Matrix4 | projection matrix} is derived from
 * {@link Camera3DOptions | options}.
 *
 * Cameras face local **-Z**, matching the glTF and OpenGL convention, so
 * {@link Container3D#lookAt | camera.lookAt(target)} orients local -Z toward
 * the target. Parent the camera under {@link View3D#root | view.root} (or any
 * descendant) and the enclosing View resolves its world transform each frame.
 *
 * Mutate {@link Camera3D#fov | fov}, {@link Camera3D#zoom | zoom},
 * {@link Camera3D#near | near}, {@link Camera3D#far | far}, or
 * {@link Camera3D#orthographicSize | orthographicSize} at any time — the View rebuilds the
 * projection matrix once per frame.
 * @example
 * ```ts
 * import { Camera3D } from '@pixi/3d';
 *
 * const camera = new Camera3D({ fov: 45, near: 0.1, far: 500 });
 * camera.position.set(0, 2.5, 7);
 * camera.lookAt({ x: 0, y: 0, z: 0 });
 *
 * view.camera = camera;
 *
 * // Swap to orthographic at runtime:
 * camera.mode = 'orthographic';
 * camera.orthographicSize = 4;
 * ```
 * @see {@link Camera3DOptions} For all constructor options.
 * @see {@link CameraMode} For projection modes.
 * @see {@link View3D#camera} For installing a camera on a View.
 * @see `OrbitCamera` (from `@pixi/3d/extras`) For orbit/pan/zoom interaction.
 * @category scene
 * @standard
 */
export class Camera3D extends Container3D {
  /**
   * Default {@link Camera3DOptions} merged under every constructor call
   *
   * `new Camera3D(opts)` resolves as `{ ...Camera3D.defaultOptions, ...opts }`. Mutate
   * to change the defaults process-wide.
   * @example
   * ```ts
   * Camera3D.defaultOptions.fov = 50;
   * Camera3D.defaultOptions.far = 2000;
   * const camera = new Camera3D(); // picks up the overrides above
   * ```
   */
  public static defaultOptions: Camera3DOptions = {
    mode: 'perspective',
    fov: 60,
    zoom: 1,
    near: 0.1,
    far: 1000,
    orthographicSize: 5,
    clippingPlane: null,
    renderTexture: null,
  };

  /**
   * Projection matrix derived from this camera's settings
   *
   * Rebuilt each frame by the View that draws this camera, for the rect its image lands in, with
   * {@link Camera3D#clippingPlane} applied. As built, never flipped for a target: the copy the GPU
   * binds is the camera data's. Treat as read-only outside the engine.
   */
  public readonly projection: Matrix4 = new Matrix4();

  /**
   * View matrix — the inverse of {@link Container3D#worldTransform}
   *
   * Rebuilt each frame by the View that draws this camera. Treat as read-only outside the
   * engine.
   */
  public readonly view: Matrix4 = new Matrix4();

  /**
   * Combined view-projection matrix (`projection * view`)
   *
   * Rebuilt each frame with the projection; {@link Camera3D#frustum} is derived from it. Treat
   * as read-only outside the engine.
   */
  public readonly viewProjection: Matrix4 = new Matrix4();

  /**
   * View-space frustum derived from {@link Camera3D#viewProjection | viewProjection}
   *
   * Rebuilt each frame. Treat as read-only. Culling reads {@link Camera3D#cullFrustum}.
   */
  public readonly frustum: Frustum = new Frustum();

  /**
   * Volume this camera culls against
   *
   * Defaults to {@link Camera3D#frustum} — the same object, so one write updates both.
   * Assign a different frustum to cull from a volume other than the one this camera draws.
   * Assign `frustum` again to restore. The projection builder writes `frustum` only.
   */
  public cullFrustum: Frustum = this.frustum;

  /**
   * Projection mode
   * @default 'perspective'
   */
  public mode: CameraMode;

  /**
   * Vertical field of view in degrees (perspective only)
   * @default 60
   */
  public fov: number;

  /**
   * Multiplicative zoom factor
   *
   * For perspective it divides `fov`; for orthographic it scales `orthographicSize`.
   * @default 1
   */
  public zoom: number;

  /**
   * Near clipping plane distance, in world units
   * @default 0.1
   */
  public near: number;

  /**
   * Far clipping plane distance, in world units
   * @default 1000
   */
  public far: number;

  /**
   * Half-width of the orthographic frustum in world units when `zoom = 1`
   * (orthographic only)
   * @default 5
   */
  public orthographicSize: number;

  /**
   * Optional oblique clipping plane
   *
   * The projection matrix is patched each frame so everything on the negative side of the plane
   * (in camera space) is clipped — the standard oblique near-plane construction, so it costs
   * nothing per fragment. This is how a mirror or a portal camera cuts its scene at the
   * surface. `null` disables clipping.
   */
  public clippingPlane: Plane | null;

  /**
   * Texture this camera's image lands in when a pass draws from it, or `null` for the view
   *
   * Give a second camera a render texture and every pass that names it — `new MeshPass({ name:
   * 'opaque', camera })` and friends — draws into that texture instead of the view: a security
   * feed on a monitor, a mirror, a portal. The target is the texture's *frame* — a pooled render
   * texture is a frame of a larger source, and pixi renders into a texture's frame too — so the
   * camera's `viewport` is a rect of that frame, usually all of it, and the projection takes the
   * frame's aspect. The passes draw into a pooled target of that size, cleared each frame, and the
   * graph copies it into the texture after the camera's last pass — so a mesh that samples this
   * texture while the camera is drawing it reads last frame's picture: a monitor showing itself
   * recurses, one frame late. Later passes in the same view sample the finished frame. Set
   * `autoGenerateMipmaps` on the texture and its mipmaps are generated after the copy. Resize the
   * texture and the target follows on the next frame.
   *
   * The view's own camera always draws the view; a texture on it is an error.
   */
  public renderTexture: RenderTexture | null;

  /**
   * What passes draw this camera from — its lanes as a uniform group with a bind group around it,
   * sharing this camera's `frustum`. Created on first use by `getCameraData`.
   * @internal
   */
  public _cameraData: CameraData | null = null;

  /**
   * Normalised viewport in {@link View3D} space — `(0, 0)` is the View's top-left
   * corner, `(1, 1)` its bottom-right
   *
   * Defaults to the full View (`0, 0, 1, 1`). Shrink to render the camera into a
   * sub-rectangle of the View (e.g. picture-in-picture, split-screen).
   */
  public readonly viewport: Rectangle = new Rectangle(0, 0, 1, 1);

  /**
   * Cameras face local -Z, so `camera.lookAt(target)` orients -Z toward the target
   *
   * Overrides `Container3D._lookAtForwardIsPositiveZ`, which defaults to +Z
   * (mesh / glTF authoring convention).
   * @internal
   */
  protected override _lookAtForwardIsPositiveZ: boolean = false;

  /**
   * Creates a new `Camera3D`
   *
   * Parent the returned instance under a {@link View3D}'s scene graph (typically
   * `view.root.addChild(camera)`) and assign it via `view.camera = camera` to use it.
   * @example
   * ```ts
   * const camera = new Camera3D({ fov: 45, near: 0.1, far: 500 });
   * view.camera = camera;
   * ```
   * @param options - construction options; see {@link Camera3DOptions}
   */
  constructor(options: Camera3DOptions = {}) {
    const { mode, fov, zoom, near, far, orthographicSize, clippingPlane, renderTexture, ...rest } = {
      ...Camera3D.defaultOptions,
      ...definedProps(options),
    };

    super({ label: 'Camera3D', ...rest });

    this.mode = mode!;
    this.fov = fov!;
    this.zoom = zoom!;
    this.near = near!;
    this.far = far!;
    this.orthographicSize = orthographicSize!;
    this.clippingPlane = clippingPlane ?? null;
    this.renderTexture = renderTexture ?? null;
  }

  /**
   * Switch to perspective projection and (optionally) set its parameters
   *
   * Equivalent to assigning `mode`, `fov`, `near`, `far` individually. Omitted
   * arguments fall back to {@link Camera3D.defaultOptions}.
   * @param fov - vertical field of view in degrees
   * @param near - near clipping plane distance
   * @param far - far clipping plane distance
   */
  public usePerspective(
    fov: number = Camera3D.defaultOptions.fov!,
    near: number = Camera3D.defaultOptions.near!,
    far: number = Camera3D.defaultOptions.far!,
  ): void {
    this.mode = 'perspective';
    this.fov = fov;
    this.near = near;
    this.far = far;
  }

  /**
   * Switch to orthographic projection and (optionally) set its parameters
   *
   * Equivalent to assigning `mode`, `orthographicSize`, `near`, `far` individually.
   * Omitted arguments fall back to {@link Camera3D.defaultOptions}.
   * @param size - half-width of the orthographic frustum at `zoom = 1`
   * @param near - near clipping plane distance
   * @param far - far clipping plane distance
   */
  public useOrthographic(
    size: number = Camera3D.defaultOptions.orthographicSize!,
    near: number = Camera3D.defaultOptions.near!,
    far: number = Camera3D.defaultOptions.far!,
  ): void {
    this.mode = 'orthographic';
    this.orthographicSize = size;
    this.near = near;
    this.far = far;
  }

  /**
   * Detaches this camera from the scene graph and removes its listeners
   *
   * Idempotent via the inherited {@link Container3D#destroyed} guard.
   *
   * The projection / view matrices and the frustum are CPU-only; the one GPU thing a camera owns
   * is the uniform + bind group its `CameraData` holds, minted on first render and freed here.
   * {@link Camera3D#clippingPlane} is left intact: it is shared and the caller may still hold it.
   * Detaching the camera from its View (clearing `view3d.camera`) is the View's responsibility;
   * there is no back-reference from the camera.
   * @param options - forwarded to {@link Container3D#destroy}
   */
  public override destroy(options?: Destroy3DOptions): void {
    if (this.destroyed) return;

    this._cameraData?.destroy();
    this._cameraData = null;

    super.destroy(options);
  }

  /**
   * Builds this camera's base projection matrix for the given aspect ratio into `out`
   *
   * "Base" means projection from camera space to NDC as configured by
   * {@link Camera3D#mode | mode} / {@link Camera3D#fov | fov} / {@link Camera3D#zoom | zoom} /
   * {@link Camera3D#orthographicSize | orthographicSize} / near / far — without the per-frame
   * viewport-placement correction the render pipe premultiplies into
   * {@link Camera3D#projection | projection}. The single source of truth for that projection
   * shape; the render path and {@link View3D#worldToScreen | screen mapping on View3D} both
   * build from it.
   * @param aspect - viewport aspect ratio (width / height)
   * @param out - matrix the projection is written into
   * @returns The `out` matrix
   */
  public computeProjection(aspect: number, out: Matrix4): Matrix4 {
    if (this.mode === 'perspective') {
      // API uses degrees for FOV; Matrix4.makePerspective expects radians.
      const fovRadians = (this.fov / this.zoom) * (Math.PI / 180);

      out.makePerspective(fovRadians, aspect, this.near, this.far);
    } else {
      const size = this.zoom * this.orthographicSize;

      out.makeOrthographic(-size, size, size / aspect, -size / aspect, this.near, this.far);
    }

    return out;
  }
}
