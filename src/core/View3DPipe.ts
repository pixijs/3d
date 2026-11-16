import type { Geometry, Shader, State, Texture, WebGLRenderer, WebGPURenderer } from 'pixi.js';

import type { ToneMapping } from '../scene/View3D';
import type { DrawTarget } from './render-graph/RenderGraph';
import type { ColorHandle } from './render-graph/ResourceHandle';
import type { RenderForwardDescriptor } from './render-passes/RenderForwardDescriptor';
import type { ReadonlyRect, RenderSession } from './render-passes/RenderSession';

/**
 * What a render pass calls on its view's pipe, so it needs no import from `core/gl` or `core/gpu`
 * @internal
 */
export interface View3DPipe {
  readonly renderer: WebGLRenderer | WebGPURenderer;

  /**
   * Uploads a pass's forward draw data and runs its cull compute before any render pass opens; WebGPU only, and
   * only for a pass that caches its draws
   */
  prepareForward(desc: RenderForwardDescriptor, session: RenderSession): void;

  /** Draws a pass's forward meshes, sorted and cached as `desc` asks */
  renderForward(desc: RenderForwardDescriptor, session: RenderSession): void;

  /** Draws one geometry to the active target, outside the batcher; the caller sets `shader.groups` */
  renderGeometry(geometry: Geometry, shader: Shader, state: State): void;

  /** Copies `source`'s content rect into `dest`'s frame, mip 0 only, and nulls `session.activeTarget` */
  copyColor(source: DrawTarget, dest: Texture, session: RenderSession): void;

  /**
   * Like `copyColor`, but through `toneMapping`, or a plain format change when that's `null`
   *
   * The graph resolves an antialiased `source` first; the pipe resolves an antialiased `dest` after writing it.
   */
  outputColor(source: DrawTarget, dest: Texture, session: RenderSession, toneMapping: ToneMapping | null): void;

  /** Fills `handle`'s mips from level 0 in the frame's encoder, so the write, the mips and the reads stay in order */
  generateMips(handle: ColorHandle, session: RenderSession): void;

  /**
   * Resolves the bound target's multisampled colour into its texture, leaving it bound
   *
   * WebGL needs it: pixi resolves only in `finishRenderPass`, which a pass that only draws never calls.
   */
  resolveColor(): void;

  /** Like `copyColor` for depth, but writes at texel (0, 0) of `dest` whatever its frame */
  copyDepth(source: DrawTarget, dest: Texture, session: RenderSession): void;

  /**
   * Narrows the live GPU viewport, in physical pixels in the backend's convention; pair each call with one that
   * restores the rect, since pixi's GL adaptor skips setting a viewport equal to the one it cached
   */
  setViewport(viewport: ReadonlyRect): void;

  /** Resets depth over `session.activeViewport` only, so other insets and 2D depth survive */
  clearDepth(session: RenderSession): void;

  /**
   * Packs this frame's lights, then writes the global uniforms; it runs after the scene update builds the view
   * camera the shadow fit reads, and before `RenderGraph.resolve`, so a pass's `condition` sees this frame
   */
  prepareView(session: RenderSession): void;
}
