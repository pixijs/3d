import { collectOverrideDefs, emitOverridesWgsl } from '../../shader/collectOverrideDefs';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

/**
 * Collects override definitions from all bits and emits WGSL `override` declarations into the
 * template's `{{header}}` slot
 * @internal
 */
export const wgslOverridesPlugin: ShaderCompilerPlugin = {
  collectData(context) {
    context.data.overrides = collectOverrideDefs(context.bits);
  },
  injectCode(context) {
    const overridesSource = emitOverridesWgsl(context.data.overrides!);
    return { header: overridesSource };
  },
};
