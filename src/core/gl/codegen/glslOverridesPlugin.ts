import { collectOverrideDefs, emitOverridesGlsl } from '../../shader/collectOverrideDefs';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

/**
 * The GLSL twin of `wgslOverridesPlugin`; GLSL ES 3.00 has no override constants, so values bake in as `#define`s
 * @internal
 */
export const glslOverridesPlugin: ShaderCompilerPlugin = {
  collectData(context) {
    context.data.overrides = collectOverrideDefs(context.bits);
  },
  injectCode(context) {
    const values = context.glslOptions?.overrides ?? {};
    const source = emitOverridesGlsl(context.data.overrides!, values);
    return { header: source };
  },
};
