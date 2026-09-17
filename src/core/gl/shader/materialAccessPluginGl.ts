import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

/**
 * Emits the per-invocation `Material material = getMaterial(...)` local that the GL template
 * hoists via `{{materialAccess}}`, but only when the compiled schema has fields
 *
 * With no `material` bindings, `glslStorageAccessPlugin` generates no `getMaterial` and no
 * `Material` struct, so emitting the access would reference undefined symbols and fail to
 * compile — omitting it lets a material-less shader (e.g. a depth-only effect) build.
 *
 * GL-only: the WebGPU path needs no equivalent. There the struct is seeded
 * empty in `collectBindings` so `array<Material>` always resolves, and the
 * template's direct `uMaterialStorage[...]` read of an unused local is dropped
 * by the WGSL compiler.
 * @internal
 */
export const materialAccessPluginGl: ShaderCompilerPlugin = {
  injectCode(context): Record<string, string> {
    const fields = context.data.structs?.Material;

    if (!fields || Object.keys(fields).length === 0) return {};

    return {
      materialAccess: 'Material material = getMaterial(vMaterialIndex);',
    };
  },
};
