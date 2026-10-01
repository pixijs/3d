import type { ShaderCompilerPlugin } from '../ShaderCompilerPlugin';
import { mergeMaterialStruct } from './materialStruct';

/**
 * Replaces the collected `Material` struct with the packed one from `mergeMaterialStruct`
 *
 * The shader's struct and each material's construction-time layout then come from one function, on
 * both backends. The material accessors and the material data class look fields up by name, so the
 * new order changes nothing for them.
 *
 * Only `Material` is repacked, because only its CPU writes follow the computed layout: the material
 * data class builds them from `createStructLayout`. `LightDataList`, `ShadowDataList` and
 * `Mesh3DDataStoreBuffer` write the other structs at fixed offsets, so those keep their declared
 * order.
 *
 * It runs in `preCompile`, so every `injectCode`, the accessors' included, sees the packed struct.
 * GLSL runs `preCompile` once per stage over the same `data`, and a second run gives the same
 * result.
 * @internal
 */
export const materialStructPackPlugin: ShaderCompilerPlugin = {
  preCompile(context) {
    const structs = context.data.structs;

    if (!structs?.Material) return;

    structs.Material = mergeMaterialStruct(context.bits);
  },
};
