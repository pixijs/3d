import type { WebGLRenderer, WebGPURenderer } from 'pixi.js';

import { normalizePassEntry } from '../../materials/PassDescriptor';
import type { PassDescriptor, PassDescriptorOptions } from '../../materials/PassDescriptor';
import type { Camera3D } from '../../scene/cameras/Camera3D';
import type { Mesh3DBatch } from '../batcher/Mesh3DBatch';
import { MeshPassCache } from '../batcher/Mesh3DData';
import type { Mesh3DData } from '../batcher/Mesh3DData';
import { updateMesh3DKeys } from '../batcher/updateMesh3DKeys';
import type { PassBuilder } from '../render-graph/PassBuilder';
import type { View3DPipe } from '../View3DPipe';
import { passBitRegistry } from './passBitRegistry';
import type { RenderSession } from './RenderSession';

/**
 * Bitmask flags controlling which render passes a mesh participates in
 *
 * Built-in passes (bits 0-7) are derived automatically from material/mesh properties:
 * - SHADOW: derived from `mesh.castShadow`
 * - OPAQUE: derived from `material.alphaMode !== 'blend'`
 * - TRANSPARENT: derived from `material.alphaMode === 'blend'`
 *
 * Custom passes (bits 8+) are auto-assigned the first time a pass with that
 * `name` is instantiated.
 * @category rendering
 * @standard
 */
export const RenderPassBit = {
  /**
   * No membership
   *
   * On a mesh: excluded from every pass. On a pass: it takes no meshes — the fullscreen effect
   * passes and the graph operations (copies, mipmap generation, depth clear, output) all carry this, so
   * they own no draw list, allocate no registry bit, and any number of them coexist in a view.
   */
  NONE: 0,

  // Built-in passes (bits 0-7) - stable constants
  /** Mesh casts shadows (derived from mesh.castShadow) */
  SHADOW: 1 << 0,
  /** Mesh is rendered in main opaque pass (derived from material.alphaMode) */
  OPAQUE: 1 << 1,
  /** Mesh is rendered in transparent pass (derived from material.alphaMode) */
  TRANSPARENT: 1 << 2,
  /** Background skybox pass */
  BACKGROUND: 1 << 3,
  /** Transmissive materials (glass) — rendered with depth writes between opaque copy and transparent */
  TRANSMISSION: 1 << 4,
  /**
   * Blended-refractive materials (e.g. water) — alpha-blended pass that samples the
   * opaque colour + depth copies for screen-space refraction. Runs after TRANSMISSION
   * and before plain TRANSPARENT.
   */
  BLENDED_REFRACTION: 1 << 5,

  // Bits 6-7 reserved for future built-in passes
  // Custom passes (bit 8+) are auto-assigned by `passBitRegistry` on construction

  /**
   * Mask covering the four mutually-exclusive material passes. Use
   * `material._passBit & MATERIAL_PASS_MASK` to isolate the single slot a material
   * belongs to, stripping shadow/background/custom bits.
   */
  MATERIAL_PASS_MASK: (1 << 1) | (1 << 2) | (1 << 4) | (1 << 5), // OPAQUE | TRANSPARENT | TRANSMISSION | BLENDED_REFRACTION
} as const;

/**
 * Options for constructing a {@link RenderPass}
 * @category rendering
 * @advanced
 */
export interface RenderPassOptions {
  /**
   * The renderer this pass will draw with
   *
   * Used to resolve `this.pipe` at construction time so `setup()` can run immediately
   * when the pass is added to the graph.
   */
  renderer: WebGLRenderer | WebGPURenderer;
  /**
   * Stable string identifier for this pass (e.g. `'shadow'`, `'outline'`)
   *
   * Used as the key in `material.passes` so users can target a pass without knowing its
   * bit. Unique per view per camera: two passes may share a name when they draw the same
   * membership from different cameras, and the second one must carry a `camera`.
   */
  name: string;
  /** Human-readable explanation shown by tooling that inspects the render graph */
  description?: string;
  /** Bitmask for this pass. Built-ins pass their constant; omit for auto-assign */
  bit?: number;
  /**
   * Pass-level defaults applied to every mesh routed through this pass
   *
   * - `shader`: default shader when a material doesn't supply one (the base class
   *   `onRenderableDirty` compiles from this and builds batch keys).
   * - `state`: overrides `material.state` for this pass (e.g. shadow's depth-only state).
   * - `topology`: forces a topology regardless of material/geometry (e.g. a wireframe
   *   debug pass).
   *
   * Each field is independently optional. Per-material entries in `material._passes`
   * still take precedence over these.
   */
  descriptor?: PassDescriptorOptions;
  /**
   * Camera this pass draws from
   *
   * Omit and the pass draws from the view's own camera, the same way a pass with no target
   * declaration draws into the scene target. Supply one — a `Camera3D` in the same View3D — and
   * the pass culls with that camera's frustum, binds its matrices, and lands its image in the
   * rect its `viewport` marks out: picture-in-picture and split-screen, with no graph knowledge.
   * Give the camera a `renderTexture` and the image lands in that texture instead — a security
   * feed, a mirror, a portal — drawn at the `'beforeOpaque'` stage so the scene can sample it.
   * A feed with glass needs its own copies and glass passes. From the {@link Pass3D#build} that
   * adds the feed's draws, give this camera to a {@link CopyDepthPass}, a {@link CopyOpaquePass}, a
   * {@link TransmissionRenderPass} and a {@link BlendedRefractionPass}, in that order after the
   * feed's opaque draw: the copies read this camera's target and the glass draws into it. Allocate
   * the copies' textures with {@link RenderGraph#createColor} and {@link RenderGraph#createDepth};
   * {@link PassContext#opaqueColor} and {@link PassContext#opaqueDepth} hold the view camera's.
   */
  camera?: Camera3D;
}

/**
 * Base class for all render passes in the pipeline
 *
 * Passes are collected into an ordered array and executed sequentially via
 * the per-View3D `RenderGraph`. Lifecycle per pass:
 * - `setup(builder)` runs once when the graph is built (after the pass list
 *   changes). Declare resource accesses through {@link PassBuilder}
 *   (`b.writeColor` / `b.writeDepth` / `b.readDepthAttachment` / `b.sample`
 *   / `b.read` / `b.produce`); the executor derives the render target from
 *   those declarations.
 * - `condition(session)` (optional) runs per frame from `RenderGraph.resolve`.
 *   Return `false` to skip the pass for that frame.
 * - `RenderGraph.prepareCameras` then builds every surviving `pass.camera`. The
 *   view's own camera and its lights were built by the pipe before `resolve`, so
 *   `condition` above already saw this frame's frustum.
 * - `prepare(session)` runs in the graph's execute pre-sweep, before any
 *   render target is bound.
 * - `render(session)` runs per frame after the graph has configured the
 *   render target. Self-managing passes (Shadow, CopyOpaque, CopyDepth)
 *   declare only `produce` / `sample` / `read` accesses — the executor
 *   skips the target push and `render()` owns all GPU push/pop work.
 *
 * The `P` generic narrows the pipe type. Constraint and default are both the
 * backend-neutral `View3DPipe` interface, so a backend-neutral pass
 * (`extends RenderPass`) programs against the interface only. A pass that
 * reaches backend-concrete members annotates its pipe:
 * `extends RenderPass<View3DPipeGpu>` (GPU) / `extends RenderPass<View3DPipeGl>`
 * (GL).
 * @category rendering
 * @advanced
 */
export class RenderPass<P extends View3DPipe = View3DPipe> {
  /**
   * Stable string identifier for this pass (e.g. `'shadow'`, `'outline'`)
   *
   * Materials key custom shader descriptors by this name in their `passes` map.
   */
  public readonly name: string;

  /** Human-readable explanation of what this pass contributes to the frame */
  public readonly description?: string;

  /** Bitmask for this pass. Set by constructor or auto-assigned from the pass name */
  public bit: number;

  /**
   * Reference to the rendering pipeline
   *
   * Resolved at construction from the `renderer` option — the pass is bound to that
   * renderer for its lifetime.
   */
  public readonly pipe: P;

  /** Pass-level defaults (shader / state / topology) for this pass */
  public descriptor?: PassDescriptor;

  /**
   * Camera this pass draws from, or `null` to draw from the view's own camera
   *
   * See {@link RenderPassOptions#camera}. Read by the forward draw path (frustum, matrices,
   * distance sort) and by the graph executor, which narrows the GPU viewport to the camera's
   * frame for the duration of `render`.
   */
  public readonly camera: Camera3D | null;

  /**
   * Whether `onRenderableDirty` updates the sorted view's key after (re)keying
   * a mesh. True for key-sorted passes (opaque, shadow); set false by
   * distance-sorted passes (transparent, blended-refraction) whose draw order
   * is recomputed every frame in the pipe, not from the per-mesh key.
   */
  protected _updatesViewKey = true;

  constructor(options: RenderPassOptions) {
    this.name = options.name;
    this.description = options.description;
    this.bit = passBitRegistry.getOrAllocate(options.name, options.bit);
    this.descriptor = options.descriptor ? normalizePassEntry(options.descriptor) : undefined;
    this.camera = options.camera ?? null;
    // The registered pipe is backend-concrete; narrow the GL/GPU union to the
    // pass's `P` (TS can't relate a union to a bare type parameter directly).
    this.pipe = options.renderer.renderPipes.view3d as unknown as P;
  }

  /**
   * Declares what resources this pass reads, writes, and samples
   *
   * Called once by the graph (after the pass list mutates) with a fresh
   * {@link PassBuilder}; record handles via `b.writeColor` / `b.writeDepth`
   * / `b.readDepthAttachment` / `b.sample` / `b.read` / `b.produce`.
   *
   * Default no-op — passes that declare nothing fall back to
   * `session.defaultTarget` with no clear.
   * @param _builder - The builder recording this pass's resource accesses
   */
  public setup(_builder: PassBuilder): void {}

  /**
   * Optional per-frame predicate
   *
   * Returning `false` skips this pass for the frame (executed entirely from
   * `RenderGraph.resolve` — `render` is not called). Default absent = always run.
   * @param session - The current frame's render session
   * @returns Whether the pass should run this frame
   */
  public condition?(session: RenderSession): boolean;

  /**
   * Prepare phase — runs in `execute`, after cameras, before any render target is bound, for every
   * pass that runs this frame
   *
   * `RenderGraph.prepareCameras` has already built every pass camera. Override to hoist GPU-buffer
   * uploads so a cull compute can run between this and `render`. Default no-op.
   * @param _session - The current frame's render session
   */
  public prepare(_session: RenderSession): void {}

  /**
   * Draws this pass's contribution to the frame
   *
   * Runs per frame after the graph has configured the render target. Default no-op.
   * @param _session - The current frame's render session
   */
  public render(_session: RenderSession): void {}

  /**
   * Called per dirty mesh that belongs to this pass
   *
   * Two shapes, both backend-agnostic (resolved through `this.pipe.renderer.material3d`):
   * - **Pass-descriptor shader** (shadow / outline / custom): compile the
   *   pass's own shader once, cache it in `_passCache[bit]`, then key the mesh.
   * - **Primary-material pass** (opaque / transparent / transmission /
   *   blended-refraction): `_passCache[bit]` is already populated by
   *   `ensureMaterial`; (re)compute the batch key via
   *   `material3d.computeBatchKey` (WebGPU pipeline key vs. WebGL
   *   `shader.uid`), then key the mesh.
   *
   * The sorted-view key is updated only when `_updatesViewKey` is true;
   * distance-sorted passes recompute draw order each frame in the pipe instead.
   * @param item - The dirty mesh to (re)key
   * @param batch - The batch the mesh belongs to
   */
  public onRenderableDirty(item: Mesh3DData, batch: Mesh3DBatch): void {
    // `drawLists`, `_passCache` and `_passes` are all keyed by pass BIT, and a bit is a
    // sparse integer key (1, 2, 4 … 256+ for custom passes), so each lookup is a dictionary
    // probe rather than an array load. Hoisted because this runs per dirty mesh per pass.
    const bit = this.bit;
    const pd = batch.drawLists[bit];
    const material = item.material;

    pd.drawDirtyId++;

    const matPd = material._passes[bit];
    const passPd = this.descriptor;
    const descriptor = (matPd && matPd.shaderDescriptor) || (passPd && passPd.shaderDescriptor);

    if (descriptor) {
      // Pass-descriptor shader is deterministic for a given (geometry, material) pair —
      // compile once and reuse, but re-resolve when either moves: the compiled bits fold
      // in the geometry's vertex formats and morph targets, and `topology` is captured by
      // value, so a swap would otherwise keep drawing from the pair the mesh had first.
      const cached = item._passCache[bit];
      if (cached && !cached.isStaleFor(item)) return;

      const shader = this.pipe.renderer.material3d.compileShader(descriptor, item);
      const state = (matPd && matPd.state) || (passPd && passPd.state) || material.state;
      const topology =
        (matPd && matPd.topology) || (passPd && passPd.topology) || material.topology || item.geometry.topology;

      // Refreshed in place when one already exists: the entry is the identity everything
      // else reads through, and re-resolving is not a reason to hand out a new object.
      let cache = cached;
      if (cache) {
        cache.shader = shader;
        cache.state = state;
        cache.topology = topology;
      } else {
        cache = item._passCache[bit] = new MeshPassCache(shader, state, topology);
      }
      cache.claimBuiltFrom(item);

      updateMesh3DKeys(item, cache, shader.uid);
      if (this._updatesViewKey) pd.view.updateKey(item.uid, item._sortKey);
      return;
    }

    // Primary-material pass — `_passCache[bit]` is populated by
    // `ensureMaterial`; recompute the backend batch key each dirty cycle.
    const cache = item._passCache[bit];
    if (!cache) return;
    updateMesh3DKeys(item, cache, this.pipe.renderer.material3d.computeBatchKey(item, bit));
    if (this._updatesViewKey) pd.view.updateKey(item.uid, item._sortKey);
  }

  /**
   * Releases GPU resources exclusively owned by this pass
   *
   * Called by the `RenderGraph` for every pass on teardown. Default no-op — passes that
   * own GPU resources (shaders, bind groups, render targets) override this. Referenced
   * shaders/geometry/bind groups that are shared or owned elsewhere must not be
   * destroyed here.
   */
  public destroy(): void {}
}
