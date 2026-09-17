import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

/**
 * GLSL compiler plugin that collects each bit's `gl.header` source and injects
 * the concatenation into the `{{header}}` slot of both stages
 * @internal
 */
export const glslHeadersPlugin: ShaderCompilerPlugin = {
  collectData(context) {
    if (!context.data.headers) {
      context.data.headers = context.bits
        .map((bit) => bit.gl?.header)
        .filter((h): h is string => !!(h && /\S/.test(h)));
    }
  },
  injectCode(context) {
    return { header: context.data.headers!.join('\n') };
  },
};
