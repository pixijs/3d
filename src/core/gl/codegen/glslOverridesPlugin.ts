import { collectOverrideDefs, emitOverridesGlsl } from '../../shader/collectOverrideDefs';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

/**
 * GLSL compiler plugin that bakes `descriptor.overrides` into the header as
 * `#define KEY VALUE` directives, mirroring the WGSL `wgslOverridesPlugin`
 *
 * Required overrides with no value supplied throw at compile time. Values are
 * read from `context.glslOptions.overrides`, which the host
 * (`compileGlslSource`) populates from the descriptor via the rest-spread
 * destructure.
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
