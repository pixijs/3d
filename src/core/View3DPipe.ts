import type { Geometry, Shader, State, WebGLRenderer, WebGPURenderer } from 'pixi.js';

import type { ColorHandle, DepthHandle } from './render-graph/ResourceHandle';
import type { RenderForwardDescriptor } from './render-passes/RenderForwardDescriptor';
import type { ReadonlyRect, RenderSession } from './render-passes/RenderSession';

/**
 * Slot indices of pass-sampled resources within the global bind group
 *
 * Values differ by backend — WebGPU inserts separate sampler bindings,
 * shifting texture slots down by one vs. WebGL — so a pass reads the index
 * from here instead of hardcoding it in `setup()`'s `b.sample(handle, slot)`.
 * One named source of truth per backend; grow by adding a key as more passes
 * sample globals.
 * @internal
 */
export interface GlobalSlots {
  /** Opaque-colour copy: produced by CopyOpaque, sampled by Transmission / BlendedRefraction (GPU 8 / GL 7) */
  readonly opaqueColor: number;
  /** Opaque-depth copy: produced by CopyDepth, sampled by BlendedRefraction (GPU 7 / GL 6) */
  readonly opaqueDepth: number;
  /** Cascaded shadow-map array — produced by the shadow pass, sampled by every lit shader (GPU 5 / GL 4) */
  readonly shadowMap: number;
}

/**
 * Backend-neutral interface a render pass programs against (`this.pipe`)
 *
 * The two concrete pipes — `View3DPipeGpu` (WebGPU) and `View3DPipeGl`
 * (WebGL) — implement it, so a pass that types `pipe` as `View3DPipe` carries
 * **zero** runtime imports from `core/gpu/**` or `core/gl/**`.
 *
 * This is the execute-phase seam: mesh draws go through `renderForward` with a
 * declarative `RenderForwardDescriptor`; the backend translates intent
 * (`sort` / `cache`) into its own mechanism.
 * @internal
 */
export interface View3DPipe {
  /** The renderer this pipe serves */
  readonly renderer: WebGLRenderer | WebGPURenderer;

  /** Backend-specific slot indices for pass-sampled global resources (see `GlobalSlots`) */
  readonly globalSlots: GlobalSlots;

  /**
   * Prepare a pass's forward meshes (upload GPU buffers) in the graph's prepare
   * pre-sweep, before the render pass opens — the seam a cull compute runs in.
   * No-op on WebGL and for immediate-replay (distance-sorted) passes.
   */
  prepareForward(desc: RenderForwardDescriptor, session: RenderSession): void;

  /**
   * Draw a pass's forward meshes per the declarative descriptor. The backend
   * walks `session.view3d._meshBatches`, sorts (key or camera distance), builds
   * its draw commands, and caches them according to the descriptor's policy.
   */
  renderForward(desc: RenderForwardDescriptor, session: RenderSession): void;

  /**
   * Draw a single geometry with a shader + state directly to the active target
   * (bypassing the batcher) — for passes that own their geometry, e.g. the
   * skybox. Bind groups ride on `shader.groups[]`, set by the caller. Wraps
   * `renderer.encoder.draw`, identical on both backends.
   */
  renderGeometry(geometry: Geometry, shader: Shader, state: State): void;

  /**
   * Blit the current colour attachment into the graph transient `handle`
   * (viewport sub-rect), writing mip 0 only. WebGPU ends the open render pass,
   * copies, and nulls `activeTarget` so the next pass reopens the encoder; WebGL
   * does only the copy (its `copyToTexture` ends the pass internally). Mip levels
   * 1+ are produced separately by `generateMips`.
   */
  copyColor(handle: ColorHandle, session: RenderSession): void;

  /**
   * Regenerate `handle`'s mip levels 1+ from level 0, in-band in the frame
   * encoder so write → mip-gen → sample stays one ordered submission. The graph
   * calls it after the last writer of any colour whose source asks for mips.
   * WebGPU records per-level downsamples; WebGL defers to `gl.generateMipmap`.
   * No-op for single-level textures.
   */
  generateMips(handle: ColorHandle, session: RenderSession): void;

  /**
   * Snapshot the current depth attachment into the graph transient `handle`
   * Same WebGPU encoder bracketing as `copyColor`; both wrap the dest in a
   * cached depth-only RenderTarget (pixijs/pixi-3d#156 removes that wrapper).
   */
  copyDepth(handle: DepthHandle, session: RenderSession): void;

  /**
   * Narrow the live GPU viewport to `viewport` (physical pixels, already in the backend's
   * convention — `frameToPhysicalViewport` bakes the WebGL root Y flip)
   *
   * The graph executor calls this to confine a camera pass's draws to that camera's frame, and
   * again to put the view's own rect back. Nothing else in the frame sets the viewport, so the
   * two calls have to be exactly paired: pixi's GL adaptor caches the last rect it set and
   * would otherwise skip re-applying it.
   */
  setViewport(viewport: ReadonlyRect): void;

  /**
   * Reset depth to the far plane over `session.activeViewport`
   * (the live GPU rect, so overlapping insets / 2D depth survive).
   * Fundamentally backend-divergent — WebGPU rasterises a fullscreen triangle
   * with colour-mask off; WebGL scissors a native `gl.clear(DEPTH)` — so it's a
   * named facade, not a `renderGeometry`.
   */
  clearDepth(session: RenderSession): void;

  /**
   * Ready the view for this frame: its lights, then its global uniforms
   *
   * Called by the pipe's own `execute` after the scene update (which built the view camera —
   * the shadow cascade fit reads its projection, so that order is load-bearing) and before the
   * session goes to the graph, so everything that is true of the view regardless of which passes
   * run is settled up front.
   *
   * Running before {@link RenderGraph#resolve} is what lets a pass's `condition` ask about this
   * frame rather than the last one: the view camera's frustum and the frame's lights are already
   * written by the time it is called.
   */
  prepareView(session: RenderSession): void;
}
