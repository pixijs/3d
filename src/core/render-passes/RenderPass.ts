import type { WebGLRenderer, WebGPURenderer } from 'pixi.js';

import { normalizePassEntry } from '../../materials/PassDescriptor';
import type { PassDescriptor, PassDescriptorOptions } from '../../materials/PassDescriptor';
import type { Camera3D } from '../../scene/cameras/Camera3D';
import type { Mesh3DBatch } from '../batcher/Mesh3DBatch';
import { MeshPassCache } from '../batcher/Mesh3DData';
import type { Mesh3DData } from '../batcher/Mesh3DData';
import { updateMesh3DKeys } from '../batcher/updateMesh3DKeys';
import type { PassBuilder } from '../render-graph/PassBuilder';
import type { SceneOutput } from '../render-graph/SceneOutput';
import { materialBitsFor } from '../render-graph/sceneOutputs';
import { DEFAULT_OUTPUT_LOCATIONS } from '../shader/codegen/collectFragmentOutputs';
import type { ShaderBit } from '../shader/ShaderBit';
import type { View3DPipe } from '../View3DPipe';
import { passBitRegistry } from './passBitRegistry';
import type { RenderSession } from './RenderSession';

/**
 * The render passes a mesh can belong to, as bit flags
 *
 * A mesh rarely needs these set by hand: its `castShadow` puts it in `SHADOW`, and its material
 * puts it in `OPAQUE`, in `TRANSPARENT` when its `alphaMode` is `'blend'`, or in `TRANSMISSION`
 * when it has `transmission`. {@link BatchedMesh3D} slots are the exception, and take these
 * through {@link BatchedMesh3D#setPassesAt}.
 *
 * A custom pass, such as an outline, gets its own bit, from bit 8 up, the first time anything uses
 * its name: the pass itself, a material's `passes` option, {@link BaseMaterial3D#enablePass} or
 * {@link Mesh3D#enablePass}. A page has room for 24 such names: a later name gets no bit, and its
 * pass draws no meshes, with no warning. The built-in passes answer to their names too, so
 * `passes: { shadow: ... }` on a material overrides the shadow pass.
 * @example
 * ```ts
 * batched.setPassesAt(0, RenderPassBit.OPAQUE | RenderPassBit.SHADOW);
 * ```
 * @category rendering
 * @standard
 */
export const RenderPassBit = {
  /**
   * No pass
   *
   * A mesh with it draws nowhere. Give it to a custom pass that draws no meshes, such as a
   * fullscreen effect, so it uses up no bit; any number of such passes can share a view.
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
   * Runs after the opaque copy and before {@link RenderPassBit.BLENDED_REFRACTION}.
   */
  TRANSMISSION: 1 << 4,
  /**
   * Blended materials that refract, such as water, drawn over copies of the opaque colour and depth
   *
   * Runs after {@link RenderPassBit.TRANSMISSION} and before {@link RenderPassBit.TRANSPARENT}.
   */
  BLENDED_REFRACTION: 1 << 5,

  /** @internal */
  MATERIAL_PASS_MASK: (1 << 1) | (1 << 2) | (1 << 4) | (1 << 5),
} as const;

/**
 * Options for constructing a {@link RenderPass}
 * @category rendering
 * @advanced
 */
export interface RenderPassOptions {
  /** Renderer the pass draws with: the {@link PassContext#renderer} a {@link Pass3D#build} call receives */
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
  /**
   * Bit for this pass; leave it out on a custom pass that draws meshes, so its name gets one, and
   * give {@link RenderPassBit.NONE} to one that draws none
   */
  bit?: number;
  /**
   * Shader, state and topology this pass uses for every mesh it draws
   *
   * Each field is optional, and a material's own entry for this pass name, in its `passes`
   * option, wins over it; {@link PassDescriptor} lists the full order. Of the passes sharing a
   * name, only the one with no `camera`, or the first when they all have one, may set this.
   *
   * On one of a material's main passes, such as `'opaque'`, a pass with a shader here must be the
   * only pass with that name, or the others can throw on WebGL.
   */
  descriptor?: PassDescriptorOptions;
  /**
   * Camera this pass draws from
   *
   * Omit it and the pass draws from the view's own camera onto the view. Give it a `Camera3D` in
   * the same view and the pass culls and draws from that camera instead. Give the camera a
   * `renderTexture` and the image lands in that texture, for a security feed, a mirror, a portal,
   * or a minimap shown in a 2D sprite; add such a pass at the `'beforeOpaque'` stage so the scene
   * can sample the texture the same frame.
   *
   * A feed with glass needs its own copies and glass passes. From the {@link Pass3D#build} that
   * adds the feed's draws, give this camera to a {@link CopyDepthPass}, a {@link CopyOpaquePass}, a
   * {@link TransmissionRenderPass} and a {@link BlendedRefractionPass}, in that order after the
   * feed's opaque draw. Allocate the copies' textures with {@link RenderGraph#createColor} and
   * {@link RenderGraph#createDepth}; {@link PassContext#opaqueColor} and
   * {@link PassContext#opaqueDepth} hold the view camera's.
   */
  camera?: Camera3D;
  /**
   * The scene outputs this pass draws into after its colour, in order; see {@link SceneOutput}
   *
   * Output `i` is written by the shader's fragment output at location `i + 1`, and a draw leaves
   * alone any output its shader doesn't write. This differs from {@link Pass3D#requiredOutputs},
   * which only makes the outputs exist this frame. The default graph gives its scene outputs to its
   * depth clear, background, opaque, transmission and transparent passes; see
   * {@link DefaultGraph3DOptions#sceneOutputs}.
   */
  attachedOutputs?: readonly SceneOutput[];
}

/**
 * Base class for all render passes in the pipeline
 *
 * Each view runs its passes in order through its {@link RenderGraph}. A pass goes through these
 * steps:
 * - `setup(builder)` runs once, when the pass is added to the graph, and declares what the pass
 *   reads and writes.
 * - `condition(session)`, if the pass has one, can skip the pass for a frame.
 * - `prepare(session)` runs before any render target is bound.
 * - `render(session)` runs once the graph has bound the pass's target. A pass that declares only
 *   `produce`, `sample` or `read` accesses gets no target bound and does its own GPU work.
 *
 * `P` is the pipe type. Leave it as `View3DPipe` to run on both backends.
 * @category rendering
 * @advanced
 */
export class RenderPass<P extends View3DPipe = View3DPipe> {
  /** The pass's name; see {@link RenderPassOptions#name} */
  public readonly name: string;

  /** Human-readable explanation of what this pass contributes to the frame */
  public readonly description?: string;

  /** Bit for this pass: the built-in one it was given, or the one its name was assigned */
  public bit = 0;

  /** The view pipe of the renderer this pass was built for */
  public readonly pipe: P;

  /** Shader, state and topology this pass uses for every mesh, from {@link RenderPassOptions#descriptor} */
  public descriptor?: PassDescriptor;

  /**
   * Camera this pass draws from, or `null` to draw from the view's own camera
   *
   * See {@link RenderPassOptions#camera}. While `render` runs, the GPU viewport is the camera's rect.
   */
  public readonly camera: Camera3D | null;

  /** Whether this pass draws in key order; `false` for a pass sorted by distance, which re-sorts every frame */
  protected _updatesViewKey = true;

  /** The scene outputs attached after the target colour; see {@link RenderPassOptions#attachedOutputs} */
  public readonly attachedOutputs: readonly SceneOutput[];

  /**
   * Shader bits a material adds when it draws in this pass, so it writes the attached outputs
   *
   * Each attached output's {@link SceneOutput#bits | bits} entry for this pass's name, in order. A
   * material with a template of its own ignores them.
   */
  public readonly materialBits: readonly ShaderBit[];

  /** The output each fragment location of a material shader in this pass writes: `color`, then each attached output */
  public readonly outputLocations: readonly string[];

  constructor(options: RenderPassOptions) {
    this.name = options.name;
    this.description = options.description;
    this.bit = passBitRegistry.getOrAllocate(options.name, options.bit);
    this.descriptor = options.descriptor ? normalizePassEntry(options.descriptor) : undefined;
    this.camera = options.camera ?? null;
    this.attachedOutputs = options.attachedOutputs ?? [];
    this.materialBits = materialBitsFor(this.attachedOutputs, this.name);
    this.outputLocations =
      this.attachedOutputs.length > 0
        ? ['color', ...this.attachedOutputs.map((output) => output.name)]
        : DEFAULT_OUTPUT_LOCATIONS;
    this.pipe = options.renderer.renderPipes.view3d as unknown as P;
  }

  /**
   * Declares writes of its camera's whole target: the colour, the attached outputs, then the depth
   * @param b - The builder recording this pass's resource accesses
   */
  protected _writeTarget(b: PassBuilder): void {
    b.writeColor(b.targetColor);
    for (let i = 0; i < this.attachedOutputs.length; i++) b.writeColor(b.getSceneOutput(this.attachedOutputs[i]));
    b.writeDepth(b.targetDepth);
  }

  /**
   * Declares what resources this pass reads, writes, and samples
   *
   * The graph calls it once, when the pass is added. The graph only runs a pass whose output the
   * frame needs, so a pass that keeps this default, which declares nothing, never runs.
   * @param _builder - The builder recording this pass's resource accesses
   */
  public setup(_builder: PassBuilder): void {}

  /**
   * Optional per-frame check; returning `false` skips the pass, `prepare` and `render` included
   *
   * The graph asks it before any pass draws, once the scene's transforms and the view's camera are
   * up to date for the frame. Without one, the pass runs every frame.
   * @param session - The current frame's render session
   * @returns Whether the pass should run this frame
   */
  public condition?(session: RenderSession): boolean;

  /**
   * Runs before any pass draws or any render target is bound, once every pass's camera is current
   *
   * Override it to upload GPU buffers early. The default does nothing.
   * @param _session - The current frame's render session
   */
  public prepare(_session: RenderSession): void {}

  /**
   * Draws this pass's contribution to the frame, once the graph has bound its target
   *
   * The default does nothing.
   * @param _session - The current frame's render session
   */
  public render(_session: RenderSession): void {}

  /**
   * Re-keys a mesh of this pass whose shader, material or geometry changed
   * @internal
   */
  public onRenderableDirty(item: Mesh3DData, batch: Mesh3DBatch, rebuildsLists: boolean): void {
    const bit = this.bit;
    const pd = batch.drawLists[bit];
    const material = item.material;

    if (rebuildsLists || !this._updatesViewKey) {
      pd.drawDirtyId++;
    } else {
      pd.move(item);
      batch._editsPending = true;
    }

    const matPd = material._passes[bit];
    const passPd = this.descriptor;
    const descriptor = (matPd && matPd.shaderDescriptor) || (passPd && passPd.shaderDescriptor);

    if (descriptor) {
      const cached = item._passCache[bit];
      if (!cached || cached.isStaleFor(item)) {
        const shader = this.pipe.renderer.material3d.compileShader(descriptor, item, batch);
        const state = (matPd && matPd.state) || (passPd && passPd.state) || material.state;
        const topology =
          (matPd && matPd.topology) || (passPd && passPd.topology) || material.topology || item.geometry.topology;

        if (cached) {
          cached.shader = shader;
          cached.mergedShader = null;
          cached.state = state;
          cached.topology = topology;
          cached.claimBuiltFrom(item);
        } else {
          (item._passCache[bit] = new MeshPassCache(shader, state, topology)).claimBuiltFrom(item);
        }
      }
    }

    const cache = item._passCache[bit];
    if (!cache) return;
    updateMesh3DKeys(item, cache, this.pipe.renderer.material3d.computeBatchKey(item, bit));
    if (this._updatesViewKey) pd.view.updateKey(item.uid, item._sortKey);
  }

  /**
   * Releases the GPU resources this pass owns alone
   *
   * The graph calls it when the graph is destroyed. Override it to free the shaders, bind groups
   * or render targets your pass created, leaving alone anything it only borrowed.
   */
  public destroy(): void {}
}
