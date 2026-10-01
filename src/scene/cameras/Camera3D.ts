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
 * - `'perspective'`: distant things look smaller, with the view's height set by `fov`.
 * - `'orthographic'`: no foreshortening, with the view's width set by `orthographicSize`. Suits
 *   isometric games, maps and editors.
 * @example
 * ```ts
 * const mode: CameraMode = isometric ? 'orthographic' : 'perspective';
 *
 * view.camera.mode = mode;
 * ```
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
   * Projection mode; see {@link Camera3D#mode}
   * @default 'perspective'
   * @example
   * ```ts
   * const mapCamera = new Camera3D({ mode: 'orthographic', orthographicSize: 20 });
   * ```
   */
  mode?: CameraMode;
  /**
   * Vertical field of view in degrees; see {@link Camera3D#fov}
   * @default 60
   * @example
   * ```ts
   * const camera = new Camera3D({ fov: 45 });
   * ```
   */
  fov?: number;
  /**
   * Zoom factor; see {@link Camera3D#zoom}
   * @default 1
   * @example
   * ```ts
   * const scope = new Camera3D({ zoom: 4 });
   * ```
   */
  zoom?: number;
  /**
   * Distance to the near clipping plane, in world units; see {@link Camera3D#near}
   * @default 0.1
   * @example
   * ```ts
   * const camera = new Camera3D({ near: 0.01, far: 100 });
   * ```
   */
  near?: number;
  /**
   * Distance to the far clipping plane, in world units; see {@link Camera3D#far}
   * @default 1000
   * @example
   * ```ts
   * const camera = new Camera3D({ near: 1, far: 5000 });
   * ```
   */
  far?: number;
  /**
   * Half the view's width in world units for an orthographic camera; see
   * {@link Camera3D#orthographicSize}
   * @default 5
   * @example
   * ```ts
   * const mapCamera = new Camera3D({ mode: 'orthographic', orthographicSize: 20 });
   * ```
   */
  orthographicSize?: number;
  /**
   * Plane that hides everything on the camera's side of it; see {@link Camera3D#clippingPlane}
   * @default null
   * @example
   * ```ts
   * const reflectionCamera = new Camera3D({ clippingPlane: waterline });
   * ```
   */
  clippingPlane?: Plane | null;
  /**
   * Texture this camera draws into; see {@link Camera3D#renderTexture}
   * @default null
   * @example
   * ```ts
   * const securityCamera = new Camera3D({ renderTexture: RenderTexture.create({ width: 256, height: 256 }) });
   * ```
   */
  renderTexture?: RenderTexture | null;
}

/**
 * The point of view a scene is drawn from
 *
 * A camera is a {@link Container3D}: move, rotate and parent it like any other node. Cameras face
 * local **-Z**, matching the glTF and OpenGL convention, so
 * {@link Container3D#lookAt | camera.lookAt(target)} points the lens at the target.
 *
 * Every {@link View3D} has a camera to start with. Assign another to {@link View3D#camera}, or
 * hand one to a pass to draw a second view of the scene, such as a minimap or a security feed.
 * The camera must be in the view's scene graph, which is what keeps its world transform current.
 *
 * Change {@link Camera3D#fov | fov}, {@link Camera3D#zoom | zoom},
 * {@link Camera3D#near | near}, {@link Camera3D#far | far} or
 * {@link Camera3D#orthographicSize | orthographicSize} at any time: the view rebuilds the
 * matrices from them every frame.
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
   * `new Camera3D(opts)` resolves as `{ ...Camera3D.defaultOptions, ...opts }`, ignoring options
   * set to `undefined`. Mutate to change the defaults process-wide. {@link Camera3D#usePerspective}
   * and {@link Camera3D#useOrthographic} read their own defaults from here too.
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
   * Projection matrix, from camera space to clip space
   *
   * The view rebuilds it every frame from the camera's settings, for the rect the image lands
   * in, with {@link Camera3D#clippingPlane} applied. Read it, but don't write it: the next frame
   * overwrites it.
   * @example
   * ```ts
   * const inverseProjection = new Matrix4().getInverse(camera.projection);
   * ```
   */
  public readonly projection: Matrix4 = new Matrix4();

  /**
   * View matrix, from world space to camera space: the inverse of the camera's world transform
   *
   * The view rebuilds it every frame. Read it, but don't write it.
   * @example
   * ```ts
   * const inCameraSpace = new Vector3(5, 0, 0).applyMatrix4(camera.view);
   * const inFront = inCameraSpace.z < 0;
   * ```
   */
  public readonly view: Matrix4 = new Matrix4();

  /**
   * `projection` times `view`, from world space to clip space
   *
   * The view rebuilds it every frame. Read it, but don't write it.
   * @example
   * ```ts
   * const clip = new Vector3(5, 0, 0).applyMatrix4(camera.viewProjection);
   * ```
   */
  public readonly viewProjection: Matrix4 = new Matrix4();

  /**
   * World-space volume this camera sees, rebuilt every frame from
   * {@link Camera3D#viewProjection | viewProjection}
   *
   * Culling tests against {@link Camera3D#cullFrustum}, which is this same object unless you
   * replace it.
   * @example
   * ```ts
   * const onScreen = camera.frustum.intersectsSphere(enemy.boundingSphere);
   * ```
   */
  public readonly frustum: Frustum = new Frustum();

  /**
   * Volume meshes are culled against when this camera draws
   *
   * Starts as the same object as {@link Camera3D#frustum}. Assign another frustum to cull against
   * a volume other than the one this camera draws, such as to watch culling at work from a
   * second viewpoint, and assign `frustum` back to restore. The view only ever rebuilds
   * `frustum`, so a frustum you assign stays as you set it.
   * @example
   * ```ts
   * const frozen = view.camera.frustum.clone();
   *
   * view.camera.cullFrustum = frozen;
   * ```
   */
  public cullFrustum: Frustum = this.frustum;

  /**
   * Projection mode; change it at any time
   * @default 'perspective'
   * @example
   * ```ts
   * camera.mode = 'orthographic';
   * camera.orthographicSize = 10;
   * ```
   */
  public mode: CameraMode;

  /**
   * Vertical field of view in degrees, for a perspective camera
   *
   * The horizontal field follows from the aspect ratio of the rect the image lands in.
   * @default 60
   * @example
   * ```ts
   * camera.fov = 35;
   * ```
   */
  public fov = 0;

  /**
   * Zoom factor
   *
   * A perspective camera divides `fov` by it, so a larger zoom narrows the view. An orthographic
   * camera multiplies `orthographicSize` by it, so a larger zoom widens the view.
   * @default 1
   * @example
   * ```ts
   * camera.zoom = aiming ? 2 : 1;
   * ```
   */
  public zoom = 0;

  /**
   * Distance to the near clipping plane, in world units; anything closer isn't drawn
   *
   * Keep it as large as the scene allows. Depth precision depends on the ratio of `far` to
   * `near`, and a tiny `near` makes distant surfaces flicker through each other.
   * @default 0.1
   * @example
   * ```ts
   * camera.near = 0.5;
   * ```
   */
  public near = 0;

  /**
   * Distance to the far clipping plane, in world units; anything further isn't drawn
   * @default 1000
   * @example
   * ```ts
   * camera.far = 200;
   * ```
   */
  public far = 0;

  /**
   * Half the view's width in world units, for an orthographic camera at a `zoom` of 1
   *
   * The height follows from the aspect ratio of the rect the image lands in.
   * @default 5
   * @example
   * ```ts
   * camera.orthographicSize = level.width / 2;
   * ```
   */
  public orthographicSize = 0;

  /**
   * Plane that hides everything on the camera's side of it, or `null` for none
   *
   * A mirror or portal camera uses one to cut its scene at the mirror's or the portal's surface.
   * The plane is in the camera's view space, and the camera has to sit on the side it hides.
   * The view builds the plane into the projection's near plane every frame, so clipping costs
   * nothing per pixel.
   * @example
   * ```ts
   * portalCamera.clippingPlane = portalExitClipPlane(exit.worldTransform, portalCamera.worldTransform);
   * ```
   */
  public clippingPlane: Plane | null;

  /**
   * Texture this camera draws into, or `null` to draw into the view
   *
   * Give a second camera a render texture and every pass that names it, such as
   * `new MeshPass({ name: 'opaque', camera })`, draws into that texture instead of the view:
   * a security feed on a monitor, a mirror, a portal. The projection takes the texture's
   * aspect ratio.
   *
   * The passes draw into a separate target, cleared each frame, and the view copies it into the
   * texture after the camera's last pass. So a mesh that samples this texture while the camera
   * is drawing it shows last frame's picture: a monitor that films itself recurses, one frame
   * late. Passes that run later in the same frame see the finished picture.
   *
   * Set `autoGenerateMipmaps` on the texture and its mipmaps are generated after each copy.
   * Resize the texture and the camera follows on the next frame. The view's own camera always
   * draws the view; a texture on it throws.
   * @example
   * ```ts
   * const feed = RenderTexture.create({ width: 256, height: 256 });
   * const securityCamera = new Camera3D({ renderTexture: feed });
   *
   * view.root.addChild(securityCamera);
   * view.passes = [new MeshPass({ name: 'opaque', camera: securityCamera })];
   * ```
   */
  public renderTexture: RenderTexture | null;

  /**
   * The data passes draw this camera from, sharing this camera's `frustum`; created on first use
   * by `getCameraData`
   * @internal
   */
  public _cameraData: CameraData | null = null;

  /**
   * Rect the camera's image fills, as fractions of the view: `(0, 0)` is the top-left corner and
   * `(1, 1)` the bottom-right
   *
   * Defaults to the whole view. Shrink it for picture-in-picture or split-screen. For a camera
   * with a {@link Camera3D#renderTexture | renderTexture}, it is a rect of that texture instead.
   * @example
   * ```ts
   * minimapCamera.viewport.set(0.75, 0, 0.25, 0.25);
   * ```
   */
  public readonly viewport: Rectangle = new Rectangle(0, 0, 1, 1);

  /**
   * Cameras face local -Z, unlike the +Z default `Container3D` gives meshes
   * @internal
   */
  protected override _lookAtForwardIsPositiveZ: boolean = false;

  /**
   * Creates a new `Camera3D`
   *
   * Assign it to {@link View3D#camera}, which adds it to `view.root` when it has no parent, or
   * add it to the view's scene graph yourself to draw a pass from it.
   * @example
   * ```ts
   * const camera = new Camera3D({ fov: 45, near: 0.1, far: 500 });
   * view.camera = camera;
   * ```
   * @param options - Construction options; see {@link Camera3DOptions}
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
   * Switches to perspective projection and sets its field of view and clipping planes
   *
   * Omitted arguments take their {@link Camera3D.defaultOptions | defaultOptions} value, not the
   * camera's current one.
   * @example
   * ```ts
   * camera.usePerspective(50, 0.1, 500);
   * ```
   * @param fov - Vertical field of view in degrees
   * @param near - Distance to the near clipping plane
   * @param far - Distance to the far clipping plane
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
   * Switches to orthographic projection and sets its size and clipping planes
   *
   * Omitted arguments take their {@link Camera3D.defaultOptions | defaultOptions} value, not the
   * camera's current one.
   * @example
   * ```ts
   * camera.useOrthographic(12);
   * ```
   * @param size - Half the view's width in world units at a `zoom` of 1
   * @param near - Distance to the near clipping plane
   * @param far - Distance to the far clipping plane
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
   * Removes the camera from the scene graph and frees the GPU data it drew from
   *
   * The {@link Camera3D#clippingPlane | clippingPlane} and
   * {@link Camera3D#renderTexture | renderTexture} are yours and are left alone. A view keeps
   * pointing at its camera after the camera is destroyed, and its next render throws, so assign
   * the view another camera first. Calling it again does nothing.
   * @example
   * ```ts
   * view.camera = gameplayCamera;
   * cutsceneCamera.destroy();
   * ```
   * @param options - Forwarded to {@link Container3D#destroy}
   */
  public override destroy(options?: Destroy3DOptions): void {
    if (this.destroyed) return;

    this._cameraData?.destroy();
    this._cameraData = null;

    super.destroy(options);
  }

  /**
   * Writes the projection this camera's settings give for an aspect ratio into `out`
   *
   * This is {@link Camera3D#projection | projection} before two things the view adds: the fit
   * to where the image lands on its target, which only changes it when the view is rotated or
   * partly off-screen, and the {@link Camera3D#clippingPlane | clippingPlane}. The view builds
   * its projection from this, and so do {@link View3D#worldToScreen} and {@link View3D#screenToRay}.
   * @example
   * ```ts
   * const thumbnailProjection = camera.computeProjection(1, new Matrix4());
   * ```
   * @param aspect - Width over height of the rect the image fills
   * @param out - Matrix the projection is written into
   * @returns `out`
   * @advanced
   */
  public computeProjection(aspect: number, out: Matrix4): Matrix4 {
    if (this.mode === 'perspective') {
      const fovRadians = (this.fov / this.zoom) * (Math.PI / 180);

      out.makePerspective(fovRadians, aspect, this.near, this.far);
    } else {
      const size = this.zoom * this.orthographicSize;

      out.makeOrthographic(-size, size, size / aspect, -size / aspect, this.near, this.far);
    }

    return out;
  }
}
