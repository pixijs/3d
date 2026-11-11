import { warn } from 'pixi.js';

import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

const VERSION_LINE = '#version 300 es';

/**
 * Mali honours GLSL ES 3.00's low default precisions, breaking data-texture fetches and `uint` maths, and most sampler
 * types have no default at all. Lists every sampler type in `WGSL_TO_GLSL_BINDING_TYPE` that GLSL ES 3.00 has.
 */
const GLSL_PRECISION_PRELUDE = `precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;
precision highp isampler2D;
precision highp sampler3D;
precision highp samplerCube;
precision highp sampler2DArray;
precision highp sampler2DShadow;
precision highp samplerCubeShadow;
precision highp sampler2DArrayShadow;`;

/** @internal */
export const glslPrecisionPlugin: ShaderCompilerPlugin = {
  preCompile(context) {
    const { templateString } = context;
    if (!templateString.includes(VERSION_LINE)) {
      warn(
        `[compileShader] ${context.stage === 'vertex' ? 'Vertex' : 'Fragment'} template has no '${VERSION_LINE}' line - ` +
          'highp precision will not be declared.',
      );
      return;
    }

    context.templateString = templateString.replace(VERSION_LINE, `${VERSION_LINE}\n${GLSL_PRECISION_PRELUDE}`);
  },
};
