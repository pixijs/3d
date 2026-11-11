import type { RenderTexture } from 'pixi.js';

import type { RenderGraph } from '../../../../core/render-graph/RenderGraph';
import type { RenderSession } from '../../../../core/render-passes/RenderSession';
import { Plane } from '../../../../math/shapes/Plane';
import { Pass3D } from '../../../../post-processing/Pass3D';
import type { Pass3DOptions, PassContext, PassStage } from '../../../../post-processing/Pass3D';
import { Camera3D } from '../../../../scene/cameras/Camera3D';
import type { Mesh3D } from '../../../../scene/Mesh3D';
import { mirrorCameraThroughPortal, portalExitClipPlane } from './mirrorCameraThroughPortal';
import { PortalFeedPass } from './PortalFeedPass';

/**
 * Options for constructing a {@link PortalPass}
 * @example
 * ```ts
 * const options: PortalPassOptions = { entry, exit, texture: feed };
 * view3d.passes = [new PortalPass(options)];
 * ```
 * @category extras:post-processing
 * @standard
 */
export interface PortalPassOptions extends Pass3DOptions {
  /**
   * The quad the viewer looks through, drawn with a {@link PortalMaterial} that shows `texture`
   * @example
   * ```ts
   * const entry = new Mesh3D({
   *   geometry: new PlaneGeometry({ width: 3, height: 4 }),
   *   material: new PortalMaterial({ texture: feed }),
   * });
   * ```
   */
  entry: Mesh3D;
  /**
   * The quad on the far side, whose `+Z` side holds the room the entry shows
   * @example
   * ```ts
   * const exit = new Mesh3D({ geometry: new PlaneGeometry({ width: 3, height: 4 }), material: new FlatMaterial() });
   * exit.position.set(60, 2, -10);
   * ```
   */
  exit: Mesh3D;
  /**
   * The texture the far side is drawn into, which the entry's material shows
   *
   * **Size it to the view, and resize it with the view.** A different aspect ratio stretches the far
   * side, and fewer pixels blur it. In a view with a `'beforeToneMapping'` effect, give it an
   * `rgba16float` format; {@link Camera3D#renderTexture} explains why.
   * @example
   * ```ts
   * const feed = RenderTexture.create({
   *   width: view3d.width,
   *   height: view3d.height,
   *   format: 'rgba16float',
   * });
   * feed.resize(view3d.width, view3d.height, app.renderer.resolution);
   * ```
   */
  texture: RenderTexture;
}

/**
 * A texture portal: a second view of the scene, drawn from behind the exit and shown on the entry
 *
 * Each frame the pass stands its {@link PortalPass#camera | camera} behind the exit as the viewer
 * stands before the entry and draws the scene from there into `texture`. The entry's
 * {@link PortalMaterial} shows that at the viewer's own screen position, so it reads as an opening
 * rather than a picture. Both quads face their local `+Z`: the entry toward the viewer, the exit
 * toward the room it shows. Give both the same `scale`: a scale only one of them has carries into
 * the camera and resizes or stretches the far side. The wall the exit is cut into, and anything
 * else between the camera and the exit, is left out. The pass draws nothing on frames the entry is
 * hidden, off screen or seen from behind.
 *
 * It needs a perspective view camera and a view that isn't rotated: with an orthographic camera
 * the far side doesn't show, and in a rotated view it doesn't line up with the opening.
 *
 * A portal that can see itself, or two that face each other, recurse one frame late per level, as
 * any {@link Camera3D#renderTexture} that films itself does. A portal draws only while its entry is
 * in the view camera's sight, so one seen *only* through another portal doesn't update.
 *
 * The far side draws only meshes in the `opaque` and `transparent` passes, with no sky: enclose the
 * far room, or add one as {@link PortalPass#camera} shows.
 * @example
 * ```ts
 * const feed = RenderTexture.create({
 *   width: view3d.width,
 *   height: view3d.height,
 *   format: 'rgba16float',
 * });
 * const geometry = new PlaneGeometry({ width: 3, height: 4 });
 * const entry = new Mesh3D({ geometry, material: new PortalMaterial({ texture: feed }) });
 * const exit = new Mesh3D({ geometry, material: new FlatMaterial() });
 * exit.position.set(60, 0, 0);
 * view3d.root.addChild(entry, exit);
 *
 * view3d.passes = [new PortalPass({ entry, exit, texture: feed })];
 * ```
 * @category extras:post-processing
 * @standard
 */
export class PortalPass extends Pass3D {
  /**
   * Always `'beforeOpaque'`, so the feed is finished before the scene draws the entry
   * @example
   * ```ts
   * const feedPasses = view3d.passes.filter((pass: Pass3D) => pass.stage === 'beforeOpaque');
   * ```
   */
  public readonly stage: PassStage = 'beforeOpaque';

  /**
   * The camera the far side is drawn from
   *
   * The pass adds it as a child of `entry`, then each frame overwrites its pose and copies the view
   * camera's `mode`, `fov`, `zoom`, `near`, `far` and `orthographicSize`, so setting those, or its
   * position and rotation, has no effect.
   *
   * It draws no sky. To give the feed one, add a {@link BackgroundPass} on this camera from a
   * `'beforeOpaque'` pass listed before the portal. That pass runs even on frames the portal skips.
   * The camera's texture is cleared before its first pass each frame, so no clear pass is needed.
   * @example
   * ```ts
   * class MyPortalSkyPass extends Pass3D {
   *   public readonly stage = 'beforeOpaque';
   *
   *   public build(graph: RenderGraph, ctx: PassContext): void {
   *     graph.addPass(new BackgroundPass({ renderer: ctx.renderer, camera: portal.camera }));
   *   }
   * }
   *
   * view3d.passes = [new MyPortalSkyPass(), portal];
   * ```
   */
  public readonly camera: Camera3D;

  /**
   * The quad the viewer looks through
   * @example
   * ```ts
   * portal.entry.visible = false;
   * ```
   */
  public readonly entry: Mesh3D;

  /**
   * The quad on the far side; move it and the far view follows
   * @example
   * ```ts
   * portal.exit.position.x += 10;
   * ```
   */
  public readonly exit: Mesh3D;

  /**
   * The texture the far side is drawn into; see {@link PortalPassOptions#texture}
   * @example
   * ```ts
   * const preview = new Sprite(portal.texture);
   * ```
   */
  public readonly texture: RenderTexture;

  /** The same instance as `camera.clippingPlane`, so it's written in place each frame */
  private readonly _clipPlane = new Plane();

  /** The session `_drawThisFrame` was decided for; relies on each frame making a new session */
  private _decidedFor: RenderSession | null = null;

  private _drawThisFrame = false;

  constructor(options: PortalPassOptions) {
    super(options);

    this.entry = options.entry;
    this.exit = options.exit;
    this.texture = options.texture;

    this.camera = new Camera3D({ renderTexture: options.texture });
    this.camera.clippingPlane = this._clipPlane;
    options.entry.addChild(this.camera);
  }

  /**
   * Adds the portal camera's opaque and transparent draws into `texture`
   * @param graph - Render graph being built.
   * @param ctx - Renderer and shared handles for this build.
   * @example
   * ```ts
   * for (const portal of portals) portal.build(graph, ctx);
   * ```
   * @advanced
   */
  public build(graph: RenderGraph, ctx: PassContext): void {
    const { renderer } = ctx;
    const camera = this.camera;

    const shouldDraw = (session: RenderSession): boolean => this._shouldDraw(session);

    graph.addPass(new PortalFeedPass({ renderer, name: 'opaque', sort: 'key', camera, shouldDraw }));
    graph.addPass(new PortalFeedPass({ renderer, name: 'transparent', sort: 'distance', camera, shouldDraw }));
  }

  private _shouldDraw(session: RenderSession): boolean {
    if (this._decidedFor === session) return this._drawThisFrame;
    this._decidedFor = session;

    const entry = this.entry;
    const viewCamera = session.view3d.camera;
    const e = entry.worldTransform.elements;
    const v = viewCamera.worldTransform.elements;
    const viewerInFront = e[8] * (v[12] - e[12]) + e[9] * (v[13] - e[13]) + e[10] * (v[14] - e[14]) > 0;

    this._drawThisFrame =
      entry.worldVisible !== 0 && viewerInFront && viewCamera.frustum.intersectsSphere(entry.boundingSphere);

    if (this._drawThisFrame) this._poseCamera(session);

    return this._drawThisFrame;
  }

  /** Writes the camera's world transform directly, so it must run after the transform walk, as `condition` does */
  private _poseCamera(session: RenderSession): void {
    const viewCamera = session.view3d.camera;
    const camera = this.camera;

    camera.mode = viewCamera.mode;
    camera.fov = viewCamera.fov;
    camera.zoom = viewCamera.zoom;
    camera.near = viewCamera.near;
    camera.far = viewCamera.far;
    camera.orthographicSize = viewCamera.orthographicSize;

    mirrorCameraThroughPortal(
      this.entry.worldTransform,
      this.exit.worldTransform,
      viewCamera.worldTransform,
      camera.worldTransform,
    );
    portalExitClipPlane(this.exit.worldTransform, camera.worldTransform, this._clipPlane);
  }

  /**
   * Releases the camera this pass made; the feed texture and the quads are the caller's
   * @example
   * ```ts
   * view3d.passes = [];
   * portal.destroy();
   * feed.destroy(true);
   * ```
   */
  public override destroy(): void {
    this.camera.destroy();
  }
}
