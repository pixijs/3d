import type { State, Topology } from 'pixi.js';

import type { ShaderBit } from '../core/shader/ShaderBit';
import { ShaderDescriptor } from '../core/shader/ShaderDescriptor';
import type { ShaderDescriptorOptions } from '../core/shader/ShaderDescriptor';

/**
 * A material's or a pass's overrides for one render pass
 *
 * Given per pass name in the `passes` option of {@link BaseMaterial3D}, and as `descriptor` when
 * creating a `RenderPass`; {@link PassDescriptor} says how they combine.
 * @category materials
 * @advanced
 */
export interface PassDescriptorOptions {
  /** Shader to draw with in this pass; plain options are wrapped in a {@link ShaderDescriptor} */
  shaderDescriptor?: ShaderDescriptor | ShaderDescriptorOptions;
  /**
   * Bits a material adds in this pass alone, one list for both backends, as its own `extraBits` are
   *
   * Read from a material's `passes` entry, and drawn only where the pass draws the material's bits:
   * a pass with a {@link RenderPassOptions#level | level}, or the material's main pass.
   * Their fields and textures join the material's own `data` and `textures`, fixed when it's built.
   */
  extraBits?: readonly ShaderBit[];
  /** Render state (blending, depth, culling) for this pass */
  state?: State;
  /** Primitive topology for this pass; see {@link BaseMaterial3DOptions#topology} for `'line-list'` */
  topology?: Topology;
}

/**
 * Pass overrides as the engine stores them: {@link PassDescriptorOptions} with the shader always a
 * {@link ShaderDescriptor}
 *
 * When the pass has a {@link RenderPassOptions#level | level}, as an outline or the shadow pass
 * does, or the material's entry for the pass or the pass's own descriptor sets `shaderDescriptor`,
 * the pass takes each field from the first that is set:
 *
 * - `shaderDescriptor`: the material's entry, then the pass's own.
 * - `state`: the material's entry, the pass's own, then `material.state`.
 * - `topology`: the material's entry, the pass's own, `material.topology`, then the geometry's.
 *
 * {@link RenderPassOptions#level} says how a `shaderDescriptor` combines with the material's own
 * bits.
 *
 * Otherwise a material's main pass (opaque, transparent, transmission or blended refraction) draws
 * with the material's shader, from {@link BaseMaterial3D#getPrimaryDescriptor}, and skips the
 * pass's own entry: `state` comes from the material's entry, then `material.state`, and `topology`
 * from the material's entry, `material.topology`, then the geometry's.
 *
 * Meshes resolve these values when they build their draw data, so giving a field a new value after
 * a render isn't supported: {@link BaseMaterial3D#clone | clone} the material with the new entry
 * and assign the copy. A changed field of a `state`
 * object reaches the meshes after {@link Mesh3D#invalidate} on each one.
 *
 * A `shadow` entry makes every mesh with the material cast; set `castShadow = false` on a mesh
 * after building it to stop one.
 * @example
 * ```ts
 * // Per-material override for one pass
 * new BaseMaterial3D({
 *   passes: {
 *     outline: {
 *       state: customState,
 *       shaderDescriptor: { bitsGpu: [outlineBitGpu], bitsGl: [outlineBitGl], template: outlineTemplate },
 *     },
 *   },
 * });
 *
 * // A shadow drawn with your own template, as written
 * new BaseMaterial3D({
 *   passes: {
 *     shadow: {
 *       shaderDescriptor: {
 *         bitsGpu: [myShadowBit],
 *         bitsGl: [instanceFetchBitGl, myShadowBit],
 *         template: myShadowTemplate,
 *       },
 *     },
 *   },
 * });
 *
 * // Pass-level default for every mesh in the pass
 * new MeshPass({
 *   name: 'xray',
 *   level: 'shape',
 *   descriptor: { state: xrayState, shaderDescriptor: xrayShader },
 * });
 * ```
 * @category materials
 * @advanced
 */
export interface PassDescriptor {
  /** Shader to draw with in this pass */
  shaderDescriptor?: ShaderDescriptor;
  /** Bits a material brings to this pass; see {@link PassDescriptorOptions#extraBits} */
  extraBits?: readonly ShaderBit[];
  /** Render state (blending, depth, culling) for this pass */
  state?: State;
  /** Primitive topology for this pass */
  topology?: Topology;
}

/**
 * Wraps plain shader options in a {@link ShaderDescriptor}
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
    extraBits: options.extraBits,
    state: options.state,
    topology: options.topology,
  };
}
