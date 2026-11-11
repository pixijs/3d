import type { RenderGraph } from '../../core/render-graph/RenderGraph';
import { ForwardRenderPass } from '../../core/render-passes/ForwardRenderPass';
import type { PassDescriptorOptions } from '../../materials/PassDescriptor';
import type { Camera3D } from '../../scene/cameras/Camera3D';
import { Pass3D } from '../Pass3D';
import type { Pass3DOptions, PassContext, SceneStage } from '../Pass3D';

/**
 * Constructor options for {@link MeshPass}
 * @category rendering
 * @advanced
 */
export interface MeshPassOptions extends Pass3DOptions {
  /**
   * The name materials opt in with, through their `passes` option; {@link RenderPassOptions#name}
   * says when two passes can share one
   */
  name: string;
  /**
   * Where in the default graph the pass draws
   *
   * Left out, a pass whose camera has a render texture draws at `'beforeOpaque'`, so the texture
   * is complete before any material samples it; any other pass draws at `'afterOpaque'`.
   */
  stage?: SceneStage;
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
   * Draw order; {@link ForwardRenderPassOptions#sort} has the choices
   * @default 'key'
   */
  sort?: 'key' | 'distance';
  /**
   * Camera to draw from, instead of the view's own
   *
   * Add it to the view's scene (`view.root.addChild(camera)`) so its transform stays current. Its
   * `viewport` places the image. Give it a `renderTexture` to draw into that texture instead, for a
   * material to show; a mesh that samples the texture while this camera draws it sees last frame's
   * picture. The pass draws only the meshes opted in by name, so glass seen from this camera needs
   * passes of its own, added from the `build` of a {@link Pass3D} listed after this one at the same
   * stage; {@link RenderPassOptions#camera} lists them.
   */
  camera?: Camera3D;
}

/**
 * Redraws every mesh that opts in by name, with an override shader and state
 *
 * A material joins by naming the pass in its `passes` option, as in `passes: { outline: true }`,
 * and a single mesh with {@link Mesh3D#enablePass}. This pass draws them again: for outlines,
 * wireframes, selection masks or decals. Batching, skinning and morph targets work as in the main
 * draw.
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

  /** The stage the pass draws at; {@link MeshPassOptions#stage} says how it's picked when left out */
  public get stage(): SceneStage {
    return this._options.stage ?? (this._options.camera?.renderTexture ? 'beforeOpaque' : 'afterOpaque');
  }

  /**
   * Adds the draw of this pass's meshes
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
        camera: options.camera,
      }),
    );
  }
}
