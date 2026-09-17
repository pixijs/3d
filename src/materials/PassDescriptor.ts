import type { State, Topology } from 'pixi.js';

import { ShaderDescriptor } from '../core/shader/ShaderDescriptor';
import type { ShaderDescriptorOptions } from '../core/shader/ShaderDescriptor';

/**
 * Input shape for a per-pass override entry
 *
 * The `shaderDescriptor` field accepts either a pre-built {@link ShaderDescriptor} or its raw
 * options (auto-wrapped at normalization time).
 *
 * Used wherever a user supplies pass overrides — the `passes:` constructor option on
 * {@link BaseMaterial3D}, and `RenderPassOptions.descriptor`.
 * @category materials
 * @advanced
 */
export interface PassDescriptorOptions {
  /** Shader recipe to compile for this pass; plain options are auto-wrapped in a {@link ShaderDescriptor} */
  shaderDescriptor?: ShaderDescriptor | ShaderDescriptorOptions;
  /** GPU render state (blend / depth / cull); overrides `material.state` */
  state?: State;
  /**
   * Primitive topology
   *
   * Overrides `material.topology` and `geometry.topology`. Caveat: a triangle-list index buffer
   * drawn as line-list yields triangle edges with 3x overdraw, not "real" wireframe — author a
   * wireframe geometry for clean output.
   */
  topology?: Topology;
}

/**
 * Resolved per-pass override entry
 *
 * Same shape as {@link PassDescriptorOptions} but with the inner `shaderDescriptor` always
 * normalized to a {@link ShaderDescriptor} instance (or `undefined`).
 *
 * Stored at `material._passes[bit]` and read at cache-build time. Each field has its own
 * resolution chain (the chain shape depends on which path is compiling — see below).
 *
 * ## Resolution chain
 *
 * **Custom passes** (shadow / outline / wireframe / user-defined) — handled
 * by `RenderPass.onRenderableDirty` and pass-specific GL hooks. Each field
 * resolves through up to four sources:
 *
 * ```text
 * shaderDescriptor: matPd.shaderDescriptor  || passPd.shaderDescriptor
 * state:            matPd.state             || passPd.state             || material.state
 * topology:         matPd.topology          || passPd.topology          || material.topology || geometry.topology
 * ```
 *
 * **Primary material pass** (opaque / transparent / transmission) — handled
 * by `MaterialSystemGpu.ensureMaterial`. The pass-level descriptor (`passPd`)
 * isn't consulted because the primary pass IS the material; the chain skips
 * straight from the per-material override to the material/geometry defaults:
 *
 * ```text
 * shaderDescriptor: built from material.getPrimaryDescriptor()  (no matPd shader)
 * state:            matPd.state    || material.state
 * topology:         matPd.topology || material.topology || geometry.topology
 * ```
 *
 * ## Mutation
 *
 * **Construction-only.** Field values are read once at cache-build time
 * (when the owning mesh's `_batchDirty` flag fires) and the cache holds
 * resolved snapshots after that. Mutating `pd.shaderDescriptor`,
 * `pd.state`, or `pd.topology` post-construction is not part of the
 * supported API surface — to change overrides, build a new material and
 * assign it to the mesh.
 *
 * Special case: `state` is stored by *reference*, so mutating its fields
 * (`pd.state!.blend = true`) propagates live at draw time. That's mutation
 * of the State object's contents, not of the PassDescriptor — fine to do.
 * @example
 * ```ts
 * // Per-material per-pass override
 * new BaseMaterial3D({
 *   passes: {
 *     outline: { state: customState, shaderDescriptor: { bitsGpu: [...], bitsGl: [...] } },
 *   },
 * });
 *
 * // Pass-level default (e.g. wireframe pass forces line-list for everyone)
 * new RenderPass({
 *   name: 'wireframe',
 *   pipe,
 *   descriptor: { topology: 'line-list', shaderDescriptor: wireframeShader },
 * });
 * ```
 * @category materials
 * @advanced
 */
export interface PassDescriptor {
  /** Shader recipe to compile for this pass, normalized to a {@link ShaderDescriptor} instance */
  shaderDescriptor?: ShaderDescriptor;
  /** GPU render state (blend / depth / cull) override */
  state?: State;
  /** Primitive topology override */
  topology?: Topology;
}

/**
 * Normalize a {@link PassDescriptorOptions} into a {@link PassDescriptor}
 *
 * Auto-wraps the inner `shaderDescriptor` into a {@link ShaderDescriptor} when raw options were
 * supplied.
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
