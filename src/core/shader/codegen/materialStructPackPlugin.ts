import type { ShaderCompilerPlugin } from '../ShaderCompilerPlugin';
import { mergeMaterialStruct } from './materialStruct';

/**
 * Repacks only `Material`, since other structs' CPU writers use fixed offsets. GLSL runs it once per
 * stage over the same `data`, so it must give the same result twice.
 * @internal
 */
export const materialStructPackPlugin: ShaderCompilerPlugin = {
  preCompile(context) {
    const structs = context.data.structs;

    if (!structs?.Material) return;

    structs.Material = mergeMaterialStruct(context.bits);
  },
};
