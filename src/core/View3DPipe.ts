import type { Geometry, Shader, State, Texture, WebGLRenderer, WebGPURenderer } from 'pixi.js';

import type { DrawTarget } from './render-graph/RenderGraph';
import type { ColorHandle } from './render-graph/ResourceHandle';
import type { RenderForwardDescriptor } from './render-passes/RenderForwardDescriptor';
import type { ReadonlyRect, RenderSession } from './render-passes/RenderSession';

/**
 * Slot indices of pass-sampled resources within the global bind group
 *
 * Values differ by backend: WebGPU's separate sampler binding puts each of these one slot later
 * than WebGL does. So a pass reads the index from here instead of hardcoding it in `setup()`'s
 * `b.sample(handle, slot)`. One named source of truth per backend; grow by adding a key as more
 * passes sample globals.
 * @internal
 */
export interface GlobalSlots {
  /** Opaque-colour copy from `CopyOpaquePass`, read by transmission and blended refraction (GPU 8 / GL 7) */
  readonly opaqueColor: number;
  /** Opaque-depth copy from `CopyDepthPass`, read by blended refraction and depth effects (GPU 7 / GL 6) */
  readonly opaqueDepth: number;
  /** Cascaded shadow-map array from the shadow pass, read by every lit shader (GPU 5 / GL 4) */
  readonly shadowMap: number;
}

/**
 * Backend-neutral interface a render pass programs against (`this.pipe`)
 *
 * The two concrete pipes, `View3DPipeGpu` (WebGPU) and `View3DPipeGl` (WebGL), implement it, so a
 * pass that types `pipe` as `View3DPipe` carries **zero** runtime imports from `core/gpu/**` or
 * `core/gl/**`.
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
   * Prepare a pass's forward meshes (upload GPU buffers) in the graph's prepare pre-sweep, before
   * the render pass opens: the seam a cull compute runs in. No-op on WebGL and for passes that
   * rebuild their draws every frame (distance-sorted ones).
   */
  prepareForward(desc: RenderForwardDescriptor, session: RenderSession): void;

  /**
   * Draw a pass's forward meshes per the declarative descriptor. The backend
   * walks `session.view3d._meshBatches`, sorts (key or camera distance), builds
   * its draw commands, and caches them according to the descriptor's policy.
   */
  renderForward(desc: RenderForwardDescriptor, session: RenderSession): void;

  /**
   * Draw a single geometry with a shader and state straight to the active target, bypassing the
   * batcher, for passes that own their geometry such as the skybox. Bind groups ride on
   * `shader.groups[]`, set by the caller. Wraps `renderer.encoder.draw`, identical on both backends.
   */
  renderGeometry(geometry: Geometry, shader: Shader, state: State): void;

  /**
   * Copy the colour in `source`'s content rect into `dest`'s frame, writing mip 0 only
   *
   * `source` is a camera's draw target, from `RenderGraph._drawTarget`. The copy nulls
   * `session.activeTarget`, so the next pass binds its target again. WebGPU closes the open
   * render pass to copy, and WebGL leaves the copy's framebuffer bound. `generateMips` produces
   * mip levels 1+ separately.
   */
  copyColor(source: DrawTarget, dest: Texture, session: RenderSession): void;

  /**
   * Regenerate `handle`'s mip levels 1+ from level 0, in-band in the frame
   * encoder so write → mip-gen → sample stays one ordered submission. The graph
   * calls it after the last writer of any colour whose source asks for mips.
   * WebGPU records per-level downsamples; WebGL defers to `gl.generateMipmap`.
   * No-op for single-level textures.
   */
  generateMips(handle: ColorHandle, session: RenderSession): void;

  /**
   * Copy the depth in `source`'s content rect into `dest`, at the origin of its source
   *
   * `source` is the same as for `copyColor`, and the copy nulls `session.activeTarget` the same
   * way. On WebGL pixi wraps `dest` in a depth-only RenderTarget, caches it, and blits into it.
   */
  copyDepth(source: DrawTarget, dest: Texture, session: RenderSession): void;

  /**
   * Narrow the live GPU viewport to `viewport`, in physical pixels and already in the backend's
   * convention (`frameToPhysicalViewport` bakes the WebGL root Y flip)
   *
   * The graph executor calls this to confine a camera pass's draws to that camera's frame, and
   * again to put the view's own rect back. Nothing else in the frame sets the viewport, so the
   * two calls have to be exactly paired: pixi's GL adaptor caches the last rect it set and
   * would otherwise skip re-applying it.
   */
  setViewport(viewport: ReadonlyRect): void;

  /**
   * Reset depth to the far plane over `session.activeViewport`, the live GPU rect, so overlapping
   * insets and 2D depth survive
   *
   * The backends differ too much for a `renderGeometry` call: WebGPU rasterises a fullscreen
   * triangle with the colour mask off, and WebGL scissors a native `gl.clear(DEPTH)`.
   */
  clearDepth(session: RenderSession): void;

  /**
   * Ready the view for this frame: its lights, then its global uniforms
   *
   * Called by the pipe's own `execute` after the scene update, which built the view camera whose
   * projection the shadow cascade fit reads, and before the session goes to the graph. So
   * everything that is true of the view regardless of which passes run is settled up front.
   *
   * Running before {@link RenderGraph#resolve} is what lets a pass's `condition` ask about this
   * frame rather than the last one: the view camera's frustum and the frame's lights are already
   * written by the time it is called.
   */
  prepareView(session: RenderSession): void;
}
