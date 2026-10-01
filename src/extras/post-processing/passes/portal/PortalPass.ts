import type { RenderTexture } from 'pixi.js';

import type { RenderGraph } from '../../../../core/render-graph/RenderGraph';
import { ForwardRenderPass } from '../../../../core/render-passes/ForwardRenderPass';
import type { ForwardRenderPassOptions } from '../../../../core/render-passes/ForwardRenderPass';
import type { RenderSession } from '../../../../core/render-passes/RenderSession';
import { Plane } from '../../../../math/shapes/Plane';
import { Pass3D } from '../../../../post-processing/Pass3D';
import type { Pass3DOptions, PassContext, PassStage } from '../../../../post-processing/Pass3D';
import { Camera3D } from '../../../../scene/cameras/Camera3D';
import type { Mesh3D } from '../../../../scene/Mesh3D';
import { mirrorCameraThroughPortal, portalExitClipPlane } from './mirrorCameraThroughPortal';

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
   * The portal the viewer looks at, its {@link PortalMaterial} showing `texture`
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
   * The portal on the far side, whose `+Z` half-space is the room the entry shows
   * @example
   * ```ts
   * const exit = new Mesh3D({ geometry: new PlaneGeometry({ width: 3, height: 4 }), material: new FlatMaterial() });
   * exit.position.set(60, 2, -10);
   * ```
   */
  exit: Mesh3D;
  /**
   * The feed the entry's material samples
   *
   * **Size it to the view.** The material maps a fragment's screen position straight onto this
   * texture's `[0, 1]` UV space, so its aspect ratio has to match the view's or the far side is
   * stretched, and matching the pixel size is what keeps it sharp. The caller owns it: it is
   * created before any graph exists, survives graph rebuilds, and is destroyed with the scene.
   *
   * The pass hands it to its camera as `renderTexture`, so the camera's image lands in it. Resize
   * it and the camera's target follows on the next frame.
   * @example
   * ```ts
   * const feed = RenderTexture.create({ width: view3d.width, height: view3d.height });
   * feed.resize(view3d.width, view3d.height, app.renderer.resolution);
   * ```
   */
  texture: RenderTexture;
}

/** Options for a `PortalFeedPass`: a forward pass plus the portal's per-frame decision */
interface PortalFeedPassOptions extends ForwardRenderPassOptions {
  /** Whether the portal is worth drawing this frame; poses the camera when it is. Idempotent per session */
  shouldDraw: (session: RenderSession) => boolean;
}

/**
 * A forward pass from the portal camera that asks the portal whether to draw before it draws
 *
 * `condition` runs in `resolve`, after the transform walk and before the graph builds any pass
 * camera: the one moment the portal can both look at this frame's viewer and place its camera
 * from it. Both of the portal's passes ask, and the portal decides once per session.
 */
class PortalFeedPass extends ForwardRenderPass {
  private readonly _shouldDraw: (session: RenderSession) => boolean;

  constructor(options: PortalFeedPassOptions) {
    super(options);
    this._shouldDraw = options.shouldDraw;
  }

  /**
   * The portal's decision, then the forward pass's: is the entry in view, and is there anything
   * to draw
   * @param session - The current frame's render session
   * @returns Whether the pass should run this frame
   * @advanced
   */
  public override condition(session: RenderSession): boolean {
    return this._shouldDraw(session) && super.condition(session);
  }
}

/**
 * A texture portal: a second view of the scene, drawn from behind the exit and shown on the entry
 *
 * Two quads and a render texture. Each frame the pass mirrors the view camera through the pair,
 * standing behind the exit exactly as the viewer stands before the entry, draws the scene from
 * there, and the entry's {@link PortalMaterial} shows that feed at the viewer's own screen
 * position. The result reads as an opening rather than a picture on a wall. Both quads face their
 * local `+Z`: the entry toward the viewer, the exit toward the room it shows.
 *
 * The caller owns the texture, sized to the view (see {@link PortalPassOptions#texture}), and
 * the two quads. The pass owns its {@link PortalPass#camera}.
 *
 * The camera borrows the view camera's lens every frame (mode, fov, zoom, near, far and
 * orthographic size), so tuning the view camera is enough: the two projections have to agree or
 * the pictures don't meet at the frame. Its `clippingPlane` is the exit surface, which lets the
 * feed ignore the wall the exit is cut into without any per-camera hiding.
 *
 * **Recursion is one frame late per level.** A mesh that samples `texture` while this camera is
 * drawing it, such as the entry seen through the exit or another portal's entry, reads last
 * frame's picture. So a portal that can see itself, and two portals facing each other, do
 * recurse, each level a frame behind the last: still for a resting viewer, smeared for a fast
 * one. One real limit: a portal is drawn only while its own entry is in the viewer's sight, so a
 * portal seen *only* through another portal never updates. Same-frame recursion needs a
 * stencil-masked portal, which this is not.
 *
 * The feed is drawn by the `opaque` and `transparent` memberships and no background: the far side
 * shows scene geometry, not sky. Enclose the far room, or give the feed a sky as
 * {@link PortalPass#camera} shows.
 * @example
 * ```ts
 * const feed = RenderTexture.create({ width: view3d.width, height: view3d.height });
 * const geometry = new PlaneGeometry({ width: 3, height: 4 });
 * const entry = new Mesh3D({ geometry, material: new PortalMaterial({ texture: feed }) });
 * const exit = new Mesh3D({ geometry, material: new FlatMaterial() });
 * exit.position.set(60, 0, 0);
 * view3d.root.addChild(entry, exit);
 *
 * view3d.passes = [new PortalPass({ entry, exit, texture: feed })];
 * ```
 * @see {@link PortalMaterial} For the surface that shows the feed.
 * @see {@link mirrorCameraThroughPortal} For the pose, and the axis convention it fixes.
 * @category extras:post-processing
 * @standard
 */
export class PortalPass extends Pass3D {
  /**
   * Always `'beforeOpaque'`: the feed is drawn after the shadow map and before the scene, so it is
   * finished by the time the entry's material samples it
   * @example
   * ```ts
   * const feedPasses = view3d.passes.filter((pass: Pass3D) => pass.stage === 'beforeOpaque');
   * ```
   */
  public readonly stage: PassStage = 'beforeOpaque';

  /**
   * The camera the far side is drawn from, posed by this pass every frame
   *
   * It is a child of the entry because a pass camera has to be in the view it draws from, and
   * under the entry it is wherever the entry goes. The parent gives it nothing else: the pass
   * overwrites its world transform each frame, so writing its position or rotation has no effect.
   *
   * It draws no sky. To give the feed one, add a {@link BackgroundPass} on this camera from a
   * `'beforeOpaque'` pass listed before the portal, so the sky draws first. That pass is outside
   * the portal's visibility check, so it still draws on frames the portal skips. The camera's
   * target is cleared before its first pass each frame, so no clear pass is needed.
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
   * The portal the viewer looks at; while it is hidden the pass skips its work
   * @example
   * ```ts
   * portal.entry.visible = false;
   * ```
   */
  public readonly entry: Mesh3D;

  /**
   * The portal on the far side; move it and the far view follows on the next frame
   * @example
   * ```ts
   * portal.exit.position.x += 10;
   * ```
   */
  public readonly exit: Mesh3D;

  /**
   * The feed the entry shows, filled by this pass each frame the entry is in view
   * @example
   * ```ts
   * const preview = new Sprite(portal.texture);
   * ```
   */
  public readonly texture: RenderTexture;

  /** The exit surface in the portal camera's view space; the camera holds this same instance */
  private readonly _clipPlane = new Plane();

  /** The session `_shouldDraw` last decided for; sessions are minted per frame */
  private _decidedFor: RenderSession | null = null;

  /** That decision */
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
   * Adds the feed's draws from the portal camera, opaque then transparent; the image lands in
   * `texture`
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

  /**
   * Whether the far side can be seen this frame, and, when it can, where from
   *
   * Three cheap outs before any work: the entry is hidden, the viewer is behind it on its `-Z`
   * side (nothing shows through a doorway from its back), or its bounds miss the view camera's
   * frustum. The view camera was built before `resolve`, so that frustum is this frame's.
   * Otherwise the camera is posed and the answer is yes. Decided once per session: both feed
   * passes ask.
   *
   * A `false` drops both passes from the frame, so the camera is never built, nothing is drawn
   * and the texture is not copied: a portal you cannot see costs nothing.
   * @param session - The current frame's render session.
   * @returns Whether the portal's passes should run.
   */
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

  /**
   * Poses the portal camera for this frame: the view camera's lens, mirrored through the pair
   *
   * Run from `_shouldDraw` on frames the portal is in view, so it lands after
   * the transform walk and before the graph builds the camera's matrices from the pose.
   *
   * The pose goes straight into the camera's world transform rather than through its position and
   * rotation: the mirror produces a matrix, decomposing it would be work thrown away, and the
   * view's transform walk has already run for the frame so nothing will overwrite it. A camera
   * has no children, so there is no cascade to miss.
   * @param session - The current frame's render session.
   */
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
