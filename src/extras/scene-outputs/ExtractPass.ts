import { Rectangle, RenderTexture } from 'pixi.js';

import type { RenderGraph } from '../../core/render-graph/RenderGraph';
import type { SceneOutput } from '../../core/render-graph/SceneOutput';
import type { RenderSession } from '../../core/render-passes/RenderSession';
import { FullscreenPass, passthroughFragment } from '../../post-processing/effects/FullscreenPass';
import { Pass3D } from '../../post-processing/Pass3D';
import type { Pass3DOptions, PassContext } from '../../post-processing/Pass3D';

const _content = new Rectangle();

/**
 * Options for {@link ExtractPass}
 * @category extras:post-processing
 * @advanced
 */
export interface ExtractPassOptions extends Pass3DOptions {
  /**
   * The scene output to copy out each frame, in a float or normalized format; WebGPU can't copy a
   * 32-bit float one such as `r32float`
   */
  output: SceneOutput;
}

/**
 * Copies a scene output out of the frame, into a texture the app keeps
 *
 * A scene output lasts only for its frame. This pass makes the view write the output and copies it
 * into {@link ExtractPass#texture} once the scene has drawn. Show that texture with a sprite, or
 * hand it to code outside the engine.
 *
 * It costs one fullscreen copy a frame. An effect that reads an output in the same frame, such as
 * an upscaler or ambient occlusion, should read it in its own pass with
 * {@link RenderGraph#getSceneOutput} instead. One texture serves one view, so give each view its
 * own pass.
 * @example
 * ```ts
 * const normals = new ExtractPass({ output: normalOutput });
 * view3d.passes = [normals];
 * app.stage.addChild(new Sprite(normals.texture));
 * ```
 * @category extras:post-processing
 * @advanced
 */
export class ExtractPass extends Pass3D {
  /** `'afterTransparent'`, once the whole scene has drawn */
  public readonly stage = 'afterTransparent';
  /** `[output]`, so the view writes it while the pass is enabled */
  public override readonly requiredOutputs: readonly SceneOutput[];

  /**
   * The copy, rewritten every frame the view renders and destroyed with the pass
   *
   * It has the output's format, so float values such as velocity come out unclamped. Its size is
   * the view's and its resolution the scene's ({@link View3D#resolution}), so it matches the scene
   * texel for texel. The pass resizes it as the view renders, after pixi has laid out the frame's
   * sprites, so a sprite showing it draws at the old size on the first frame and on a frame the
   * view resizes. Code that reads it after `render()` sees the new size.
   */
  public readonly texture: RenderTexture;

  /** The output this pass copies */
  public readonly output: SceneOutput;

  constructor(options: ExtractPassOptions) {
    super(options);
    const { output } = options;

    if (output.format.includes('int')) {
      throw new Error(
        `ExtractPass: '${output.name}' is ${output.format}, and the copy samples it as floats. ` +
          'Copy an integer output in a pass of your own, with a fragment that loads it.',
      );
    }

    this.output = output;
    this.requiredOutputs = [output];
    this.texture = RenderTexture.create({
      width: 1,
      height: 1,
      format: output.format,
      label: `extract:${output.name}`,
      dynamic: true,
    });
  }

  /**
   * Adds the copy to the frame's render graph
   * @param graph - The graph being built
   * @param ctx - The renderer for the copy
   * @advanced
   */
  public build(graph: RenderGraph, ctx: PassContext): void {
    graph.addPass(
      new FullscreenPass({
        renderer: ctx.renderer,
        label: `extract:${this.output.name}`,
        fragment: passthroughFragment,
        reads: { color: graph.getSceneOutput(this.output) },
        writes: graph.importColor((session) => this._fit(graph, session)),
      }),
    );
  }

  /** Destroys {@link ExtractPass#texture} */
  public override destroy(): void {
    this.texture.destroy(true);
  }

  private _fit(graph: RenderGraph, session: RenderSession): RenderTexture {
    const { width, height } = graph.sceneViewport(session, _content);
    const resolution = graph.resolution;
    const source = this.texture.source;

    if (source.pixelWidth !== width || source.pixelHeight !== height || source.resolution !== resolution) {
      source.resize(width / resolution, height / resolution, resolution);
      this.texture.update();
    }

    return this.texture;
  }
}
