import { collectOverrideDefs, emitOverridesGlsl } from '../../shader/collectOverrideDefs';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

/**
 * GLSL compiler plugin that bakes the bits' overrides into the header as `#define KEY VALUE` lines
 *
 * Values come from `glslOptions.overrides`, falling back to each override's default; a required
 * override with no value throws. The WGSL twin is `wgslOverridesPlugin`.
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
