import { generateGroupMap } from '../../shader/codegen/generateGroupMap';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

/** @internal */
export const glslGroupMapPlugin: ShaderCompilerPlugin = {
  collectData(context) {
    if (!context.data.groupMap) {
      context.data.groupMap = generateGroupMap(context.bits, context.template);
    }
  },
};
