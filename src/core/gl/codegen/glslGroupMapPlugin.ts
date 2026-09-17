import { generateGroupMap } from '../../shader/codegen/generateGroupMap';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

/**
 * GLSL compiler plugin that derives the WebGL group map (bind group/binding
 * indices → uniform names) once and stores it on `context.data.groupMap` for
 * `Shader.from()`
 * @internal
 */
export const glslGroupMapPlugin: ShaderCompilerPlugin = {
  collectData(context) {
    if (!context.data.groupMap) {
      context.data.groupMap = generateGroupMap(context.bits, context.template);
    }
  },
};
