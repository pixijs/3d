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
 * The render passes a mesh can belong to, as bit flags
 *
 * A mesh rarely needs these set by hand: its `castShadow` puts it in `SHADOW`, and its material
 * puts it in `OPAQUE`, in `TRANSPARENT` when its `alphaMode` is `'blend'`, or in `TRANSMISSION`
 * when it has `transmission`. {@link BatchedMesh3D} slots are the exception, and take these
 * through {@link BatchedMesh3D#setItemActive}.
 *
 * Bits 0 to 7 belong to the built-in passes, and 6 and 7 are spare. A custom pass, such as an
 * outline, gets bit 8 or above the first time anything uses its name: the pass itself, a
 * material's `passes` option, or {@link BaseMaterial3D#enablePass}. The built-in passes answer to
 * their names too, so `passes: { shadow: ... }` on a material overrides the shadow pass.
 * @example
 * ```ts
 * batched.setItemActive(0, RenderPassBit.OPAQUE | RenderPassBit.SHADOW);
 * ```
 * @category rendering
 * @standard
 */
export const RenderPassBit = {
  /**
   * No pass
   *
   * A mesh with it draws nowhere. A pass with it takes no meshes, like the fullscreen effects,
   * the copies, the depth clear and the output blit: it owns no draw list, uses up no custom bit,
   * and any number of such passes can share a view.
   */
  NONE: 0,

  /** Casts shadows; set from the mesh's `castShadow` */
  SHADOW: 1 << 0,
  /** Drawn in the opaque pass, where a material goes by default */
  OPAQUE: 1 << 1,
  /** Drawn in the transparent pass, back to front; set by a material `alphaMode` of `'blend'` */
  TRANSPARENT: 1 << 2,
  /** The sky drawn behind the scene */
  BACKGROUND: 1 << 3,
  /**
   * Glass and other transmissive materials, drawn over a copy of the opaque picture
   *
   * Runs after the opaque copy and before {@link RenderPassBit.BLENDED_REFRACTION}, and writes depth.
   */
  TRANSMISSION: 1 << 4,
  /**
   * Blended materials that refract, such as water, drawn over copies of the opaque colour and depth
   *
   * Runs after {@link RenderPassBit.TRANSMISSION} and before {@link RenderPassBit.TRANSPARENT}.
   */
  BLENDED_REFRACTION: 1 << 5,

  /**
   * `OPAQUE`, `TRANSPARENT`, `TRANSMISSION` and `BLENDED_REFRACTION` together: the passes that draw
   * a material with its own shader, one of which each material belongs to
   *
   * The material systems mask a material's `_passBit` with it to find that pass.
   * @internal
   */
  MATERIAL_PASS_MASK: (1 << 1) | (1 << 2) | (1 << 4) | (1 << 5),
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
   * Read in the constructor, so {@link RenderPass#pipe} is ready when the graph calls
   * {@link RenderPass#setup}, which it does as soon as the pass is added.
   */
  renderer: WebGLRenderer | WebGPURenderer;
  /**
   * Stable string identifier for this pass, such as `'shadow'` or `'outline'`
   *
   * Materials name the pass by it in their `passes` option, so they never need its bit. Several
   * passes in a view can share a name to draw the same meshes from different cameras, but only one
   * of them may leave out `camera`.
   */
  name: string;
  /** Human-readable explanation shown by tooling that inspects the render graph */
  description?: string;
  /** Bit for this pass; built-in passes give their {@link RenderPassBit}, custom passes leave it out */
  bit?: number;
  /**
   * Shader, state and topology this pass uses for every mesh it draws
   *
   * Each field is optional, and a material's own entry for this pass name, in its `passes`
   * option, wins over it; {@link PassDescriptor} lists the full order. Of the passes sharing a
   * name, only the one that owns it may set this: the one with no `camera`, or the first one when
   * they all have one.
   */
  descriptor?: PassDescriptorOptions;
  /**
   * Camera this pass draws from
   *
   * Omit it and the pass draws from the view's own camera onto the view. Give it a `Camera3D` in
   * the same view and the pass culls with that camera's frustum, uses its matrices, and lands
   * its image in the rect the camera's `viewport` marks out: picture-in-picture and split-screen.
   * Give the camera a `renderTexture` and the image lands in that texture instead, for a security
   * feed, a mirror or a portal; add such a pass at the `'beforeOpaque'` stage so the scene can
   * sample the texture the same frame.
   *
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
 * Each view runs its passes in order through its {@link RenderGraph}. A pass goes through these
 * steps, all but `setup` every frame inside {@link RenderGraph#run}:
 * - `setup(builder)` runs once, when the pass is added to the graph. It declares what the pass
 *   reads and writes through the {@link PassBuilder}, and the graph picks the render target from
 *   those declarations.
 * - `condition(session)`, if the pass has one, runs when the graph picks this frame's passes;
 *   returning `false` skips the pass for that frame. The view's camera and lights are already up
 *   to date for the frame.
 * - The graph then builds the camera of every pass still running.
 * - `prepare(session)` runs before any render target is bound.
 * - `render(session)` runs once the graph has bound the pass's target. A pass that declares only
 *   `produce`, `sample` or `read` accesses, such as the shadow pass and the copies, gets no target
 *   bound and does all its own GPU work.
 *
 * `P` is the pipe type. Leave it as the backend-neutral `View3DPipe` to run on both backends; a
 * pass that needs one backend's members names that backend's pipe instead.
 * @category rendering
 * @advanced
 */
export class RenderPass<P extends View3DPipe = View3DPipe> {
  /**
   * Stable string identifier for this pass, such as `'shadow'` or `'outline'`
   *
   * Materials name the pass by it in their `passes` option.
   */
  public readonly name: string;

  /** Human-readable explanation of what this pass contributes to the frame */
  public readonly description?: string;

  /** Bit for this pass: the built-in one it was given, or the one its name was assigned */
  public bit = 0;

  /** The view pipe of the renderer this pass was built for, which it keeps for life */
  public readonly pipe: P;

  /** Shader, state and topology this pass uses for every mesh, from {@link RenderPassOptions#descriptor} */
  public descriptor?: PassDescriptor;

  /**
   * Camera this pass draws from, or `null` to draw from the view's own camera
   *
   * See {@link RenderPassOptions#camera}. While `render` runs, the graph narrows the GPU viewport
   * to the camera's rect.
   */
  public readonly camera: Camera3D | null;

  /**
   * Whether `onRenderableDirty` writes a re-keyed mesh's key into the pass's sorted view
   *
   * `true` for passes that draw in key order, such as opaque and shadow. A pass sorted by distance
   * re-sorts every frame and never reads the key, so {@link ForwardRenderPass} turns this off for it.
   */
  protected _updatesViewKey = true;

  constructor(options: RenderPassOptions) {
    this.name = options.name;
    this.description = options.description;
    this.bit = passBitRegistry.getOrAllocate(options.name, options.bit);
    this.descriptor = options.descriptor ? normalizePassEntry(options.descriptor) : undefined;
    this.camera = options.camera ?? null;
    this.pipe = options.renderer.renderPipes.view3d as unknown as P;
  }

  /**
   * Declares what resources this pass reads, writes, and samples
   *
   * The graph calls it once, when the pass is added, with the graph's {@link PassBuilder}. The
   * graph only runs a pass whose output the frame needs, so a pass that keeps this default, which
   * declares nothing, never runs.
   * @param _builder - The builder recording this pass's resource accesses
   */
  public setup(_builder: PassBuilder): void {}

  /**
   * Optional per-frame check; returning `false` skips the pass for the frame
   *
   * The graph calls it when it picks this frame's passes, before any of them draws. A skipped pass
   * gets no `prepare` or `render` call. Without one, the pass runs every frame.
   * @param session - The current frame's render session
   * @returns Whether the pass should run this frame
   */
  public condition?(session: RenderSession): boolean;

  /**
   * Runs for every pass that runs this frame, after the graph builds the pass cameras and before
   * any pass draws or any render target is bound
   *
   * Override it to upload GPU buffers early, so a compute cull can run between this and `render`.
   * The default does nothing.
   * @param _session - The current frame's render session
   */
  public prepare(_session: RenderSession): void {}

  /**
   * Draws this pass's contribution to the frame
   *
   * Runs every frame the pass runs, once the graph has bound its target. The default does nothing.
   * @param _session - The current frame's render session
   */
  public render(_session: RenderSession): void {}

  /**
   * Re-keys a mesh of this pass whose shader, material or geometry changed
   *
   * A pass with a shader of its own, from its descriptor or the material's entry for the pass
   * (shadow, outline, custom passes), compiles that shader for the mesh and caches it with the
   * resolved state and topology. The compile folds in the geometry's vertex formats and morph
   * targets, and the topology is copied, so the entry is resolved again only when the mesh's
   * geometry or material has changed since. It is refreshed in place rather than replaced, since
   * other code holds the entry. A material's own pass (opaque, transparent, transmission, blended
   * refraction) already has its shader, and only recomputes the mesh's batch key.
   *
   * A re-keyed mesh's sort key goes into the pass's sorted view when `_updatesViewKey` is on.
   * @param item - The dirty mesh to (re)key
   * @param batch - The batch the mesh belongs to
   * @internal
   */
  public onRenderableDirty(item: Mesh3DData, batch: Mesh3DBatch): void {
    const bit = this.bit;
    const pd = batch.drawLists[bit];
    const material = item.material;

    pd.drawDirtyId++;

    const matPd = material._passes[bit];
    const passPd = this.descriptor;
    const descriptor = (matPd && matPd.shaderDescriptor) || (passPd && passPd.shaderDescriptor);

    if (descriptor) {
      const cached = item._passCache[bit];
      if (cached && !cached.isStaleFor(item)) return;

      const shader = this.pipe.renderer.material3d.compileShader(descriptor, item);
      const state = (matPd && matPd.state) || (passPd && passPd.state) || material.state;
      const topology =
        (matPd && matPd.topology) || (passPd && passPd.topology) || material.topology || item.geometry.topology;

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

    const cache = item._passCache[bit];
    if (!cache) return;
    updateMesh3DKeys(item, cache, this.pipe.renderer.material3d.computeBatchKey(item, bit));
    if (this._updatesViewKey) pd.view.updateKey(item.uid, item._sortKey);
  }

  /**
   * Releases the GPU resources this pass owns alone
   *
   * The graph calls it on every pass when it is destroyed. The default does nothing. A pass that
   * owns shaders, bind groups or render targets overrides it, and leaves alone anything it only
   * borrowed.
   */
  public destroy(): void {}
}
