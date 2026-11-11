import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

/** @internal */
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
