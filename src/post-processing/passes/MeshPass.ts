import type { RenderGraph } from '../../core/render-graph/RenderGraph';
import { ForwardRenderPass } from '../../core/render-passes/ForwardRenderPass';
import type { PassDescriptorOptions } from '../../materials/PassDescriptor';
import type { Camera3D } from '../../scene/cameras/Camera3D';
import { Pass3D } from '../Pass3D';
import type { Pass3DOptions, PassContext, PassStage } from '../Pass3D';

/**
 * Constructor options for {@link MeshPass}
 * @category rendering
 * @advanced
 */
export interface MeshPassOptions extends Pass3DOptions {
  /**
   * Pass name — the key a material opts in with via its `passes` option
   *
   * Unique per view per camera: naming an existing pass draws that same membership again, and
   * a second pass on one name must carry a {@link MeshPassOptions#camera}.
   */
  name: string;
  /**
   * Where in the default graph the pass draws
   *
   * Left out, a camera with a render texture draws at `'beforeOpaque'`, so its texture is
   * complete before any material samples it; anything else draws at `'afterOpaque'`.
   */
  stage?: Exclude<PassStage, 'post'>;
  /** Human-readable explanation shown by graph tooling */
  description?: string;
  /**
   * Shader, state and topology for meshes whose material doesn't override them for this pass
   *
   * A material's own `passes[name]` entry wins field by field; anything it leaves out falls
   * back to this, then to the material's own state and topology.
   */
  descriptor?: PassDescriptorOptions;
  /**
   * Draw ordering — stable batch-key order (cacheable) or back-to-front by distance
   * @default 'key'
   */
  sort?: 'key' | 'distance';
  /**
   * Whether the draw packs a texture atlas for the shader to sample
   *
   * Set `false` for solid-colour or depth-only shaders.
   * @default true
   */
  textures?: boolean;
  /**
   * Camera to draw from, instead of the view's own
   *
   * The camera must live in the view's scene graph (`view.root.addChild(camera)`) — that is
   * what keeps its world transform current. Its `viewport` decides where its image lands: a
   * corner of the view for a minimap, half of it for split-screen. Give the camera a
   * `renderTexture` and the image lands in that texture instead, ready for a material to show —
   * a security feed, a mirror. A mesh that samples that texture while this camera draws it
   * reads last frame's picture. This pass only redraws the named membership: glass seen from this
   * camera needs its own {@link CopyOpaquePass} and {@link TransmissionRenderPass} (plus a
   * {@link CopyDepthPass} and {@link BlendedRefractionPass} for blended refraction) pointed at it,
   * added from the `build` of a {@link Pass3D} listed after this one at the same stage. See
   * {@link RenderPassOptions#camera}.
   */
  camera?: Camera3D;
}

/**
 * Redraws every mesh that opts in by name, with an override shader and state
 *
 * The generic second pass of a multi-pass material: a material declares `passes: { outline:
 * true }` and this pass draws it again — extruded hulls, wireframes, selection masks, decals.
 * The shader comes from the material's per-pass entry or from {@link MeshPassOptions#descriptor};
 * the draw itself is the engine's forward path, so batching, skinning and morph targets come
 * for free on both backends.
 * @example
 * ```ts
 * new View3D({ passes: [new MeshPass({ name: 'wireframe', descriptor: wireframeDescriptor })] });
 * new Material3D({ passes: { wireframe: true } });
 * ```
 * @category rendering
 * @advanced
 */
export class MeshPass extends Pass3D {
  /** Pass name materials opt in with */
  public readonly name: string;

  private readonly _options: MeshPassOptions;

  constructor(options: MeshPassOptions) {
    super(options);
    this.name = options.name;
    this._options = options;
  }

  /**
   * Stage of the default graph the pass draws at
   *
   * The one given, or derived from the camera: a camera with a render texture draws before the
   * scene, so its texture is complete before any material samples it; anything else draws after
   * the opaque pass. Read at graph build, so it follows the camera's texture.
   */
  public get stage(): Exclude<PassStage, 'post'> {
    return this._options.stage ?? (this._options.camera?.renderTexture ? 'beforeOpaque' : 'afterOpaque');
  }

  /**
   * Add the forward draw for this pass's meshes
   * @param graph - Render graph being built.
   * @param ctx - Renderer and shared handles for this build.
   */
  public build(graph: RenderGraph, ctx: PassContext): void {
    const options = this._options;
    graph.addPass(
      new ForwardRenderPass({
        renderer: ctx.renderer,
        name: options.name,
        description: options.description,
        descriptor: options.descriptor,
        sort: options.sort ?? 'key',
        textures: options.textures,
        camera: options.camera,
      }),
    );
  }
}
