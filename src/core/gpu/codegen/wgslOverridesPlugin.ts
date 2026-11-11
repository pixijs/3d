import { collectOverrideDefs, emitOverridesWgsl } from '../../shader/collectOverrideDefs';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

/** @internal */
export const wgslOverridesPlugin: ShaderCompilerPlugin = {
  collectData(context) {
    context.data.overrides = collectOverrideDefs(context.bits);
  },
  injectCode(context) {
    const overridesSource = emitOverridesWgsl(context.data.overrides!);
    return { header: overridesSource };
  },
};
