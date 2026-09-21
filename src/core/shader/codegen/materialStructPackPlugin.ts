import type { ShaderCompilerPlugin } from '../ShaderCompilerPlugin';
import { mergeMaterialStruct } from './materialStruct';

/**
 * Plugin that canonicalises the `Material` struct
 *
 * Replaces the generic per-backend merge wholesale with `mergeMaterialStruct` (merge + alignment
 * pack), so the compiled struct and a material's construction-time layout derive from one
 * function. Shared by both backends; everything downstream — WGSL struct emission, the GLSL
 * storage accessor, and the JIT material sync function — derives field offsets from this def by
 * name, so the reorder is invisible to consumers.
 *
 * Scoped to the struct named `Material` only: it is the one struct whose CPU-side writes are
 * generated from the same layout (`createMaterialSyncFunction` → `createStructLayout`). `Light`,
 * `ShadowData` and `Renderable` are hand-packed CPU-side at fixed float offsets
 * (`LightDataList`, `ShadowDataList`, `Mesh3DDataStoreBuffer`) — repacking those
 * would silently corrupt them, so they keep declaration order.
 *
 * Runs in `preCompile`. On the GPU path it must be registered before
 * `materialStoragePaddingPlugin` so `_pad` is computed from the packed layout and stays last.
 * Idempotent — the GLSL pipeline runs `preCompile` once per stage over shared `data`.
 * @internal
 */
export const materialStructPackPlugin: ShaderCompilerPlugin = {
  preCompile(context) {
    const structs = context.data.structs;

    if (!structs?.Material) return;

    structs.Material = mergeMaterialStruct(context.bits);
  },
};
