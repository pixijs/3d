import type { WebGLRenderer, WebGPURenderer } from 'pixi.js';

import type { ColorHandle } from '../../core/render-graph/ResourceHandle';
import { toneOutputBits } from '../../core/shader/bits/tonemapping/toneMappingBits';
import type { ToneMapping } from '../../scene/View3D';
import { FullscreenPass, passthroughFragment } from './FullscreenPass';

/**
 * Options for an {@link OutputPass}
 * @category rendering
 * @advanced
 */
export interface OutputPassOptions {
  /** The renderer the pass draws with */
  renderer: WebGLRenderer | WebGPURenderer;
  /** The image to show: the scene colour, or the last post effect's result */
  source: ColorHandle;
  /**
   * The tone curve and display encode to apply to the image, for a scene that holds linear light
   *
   * Left out, or `'custom'`, the pass copies the image unchanged.
   */
  toneMapping?: ToneMapping;
  /**
   * Where the image lands; {@link FullscreenPassOptions#writes} has the choices
   * @default null
   */
  writes?: ColorHandle | null;
}

/**
 * Finishes a view's image: applies the tone curve and display encode to a scene that holds linear
 * light, or copies the image unchanged (see {@link View3D#toneMapping})
 *
 * A see-through background keeps its edges over the 2D content beneath. Unless it copies, the pass
 * also dithers so smooth gradients don't band in an 8-bit target. A custom graph whose scene is linear
 * ({@link RenderGraph#sceneIsLinear}) needs one to finish the image. Inside a
 * {@link View3DOptions#graph | graph} builder, pass the builder's `options.toneMapping`, so a
 * change to {@link View3D#toneMapping} reaches the pass when the graph rebuilds.
 * @example
 * ```ts
 * graph.addPass(new OutputPass({ renderer, source: graph.sceneColor, toneMapping: options.toneMapping }));
 * ```
 * @category rendering
 * @advanced
 */
export class OutputPass extends FullscreenPass {
  constructor(options: OutputPassOptions) {
    super({
      renderer: options.renderer,
      label: 'output',
      fragment: passthroughFragment,
      reads: { color: options.source },
      writes: options.writes ?? null,
      extraBits: toneOutputBits(options.toneMapping),
    });
  }
}
