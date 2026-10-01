import type { State, Topology } from 'pixi.js';

import { ShaderDescriptor } from '../core/shader/ShaderDescriptor';
import type { ShaderDescriptorOptions } from '../core/shader/ShaderDescriptor';

/**
 * A material's or a pass's overrides for one render pass
 *
 * Given per pass name in the `passes` option of {@link BaseMaterial3D}, and as `descriptor` when
 * creating a `RenderPass`. Every field is optional; {@link PassDescriptor} explains how they combine.
 * @category materials
 * @advanced
 */
export interface PassDescriptorOptions {
  /** Shader to draw with in this pass; plain options are wrapped in a {@link ShaderDescriptor} */
  shaderDescriptor?: ShaderDescriptor | ShaderDescriptorOptions;
  /** Render state (blending, depth, culling) for this pass */
  state?: State;
  /**
   * Primitive topology for this pass
   *
   * `'line-list'` joins the indices in pairs, so a triangle index buffer drawn that way isn't a
   * wireframe: it draws some edges and misses others. Use a geometry with line indices for that.
   */
  topology?: Topology;
}

/**
 * Pass overrides as the engine stores them: {@link PassDescriptorOptions} with the shader always a
 * {@link ShaderDescriptor}
 *
 * ## Which value wins
 *
 * In a custom pass, such as an outline or shadow pass, each field takes the first value that is
 * set, in this order:
 *
 * - `shaderDescriptor`: the material's entry for the pass, then the pass's own descriptor.
 * - `state`: the material's entry, the pass's own, then `material.state`.
 * - `topology`: the material's entry, the pass's own, `material.topology`, then the geometry's.
 *
 * In a material's main pass (opaque, transparent or transmission) the shader always comes from
 * {@link BaseMaterial3D#getPrimaryDescriptor}, and no pass-level entry is read:
 *
 * - `state`: the material's entry for the pass, then `material.state`.
 * - `topology`: the material's entry, `material.topology`, then the geometry's.
 *
 * ## Changing one
 *
 * Meshes resolve these values when they build their draw data, not every frame, and a custom pass
 * doesn't resolve them again for a mesh until its geometry or material changes. So giving a field
 * a new value after the descriptor has rendered isn't supported: build a new material with the
 * overrides and assign it. The `state` object is kept by reference, so a change to one of its
 * fields does reach the meshes, after {@link Mesh3D#invalidate} on each one, since WebGPU replays
 * the draws it recorded with the old state.
 * @example
 * ```ts
 * // Per-material override for one pass
 * new BaseMaterial3D({
 *   passes: {
 *     outline: { state: customState, shaderDescriptor: { bitsGpu: [outlineBitGpu], bitsGl: [outlineBitGl] } },
 *   },
 * });
 *
 * // Pass-level default for every mesh in the pass
 * new RenderPass({
 *   renderer,
 *   name: 'xray',
 *   descriptor: { state: xrayState, shaderDescriptor: xrayShader },
 * });
 * ```
 * @category materials
 * @advanced
 */
export interface PassDescriptor {
  /** Shader to draw with in this pass */
  shaderDescriptor?: ShaderDescriptor;
  /** Render state (blending, depth, culling) for this pass */
  state?: State;
  /** Primitive topology for this pass */
  topology?: Topology;
}

/**
 * Normalize a {@link PassDescriptorOptions} into a {@link PassDescriptor}, wrapping plain shader options
 * @param options - Pass override entry as supplied by the user
 * @returns The normalized entry
 * @internal
 */
export function normalizePassEntry(options: PassDescriptorOptions): PassDescriptor {
  return {
    shaderDescriptor:
      options.shaderDescriptor === undefined
        ? undefined
        : options.shaderDescriptor instanceof ShaderDescriptor
          ? options.shaderDescriptor
          : new ShaderDescriptor(options.shaderDescriptor),
    state: options.state,
    topology: options.topology,
  };
}
