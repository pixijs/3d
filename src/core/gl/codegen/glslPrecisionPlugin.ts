import { warn } from 'pixi.js';

import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

const VERSION_LINE = '#version 300 es';

/**
 * Default precision declarations for GLSL ES 3.00 shaders compiled by `compileGlslSource`
 *
 * GLSL ES 3.00 declares `sampler2D` and `samplerCube` as `lowp` in both stages, and fragment
 * `int` as `mediump`. The fragment stage has no default float precision, and the other sampler
 * types have no default at all, so declaring one without a precision fails to compile. Desktop
 * and Apple GPUs run everything at `highp` anyway, but Mali honours the defaults: data-texture
 * fetches would come back at half-float precision and `uint` bit maths would break. GLSL ES 3.00
 * requires `highp` support in both stages, so these lines are safe everywhere.
 *
 * Lists every sampler type `WGSL_TO_GLSL` in `glslBindingsPlugin` maps to, except
 * `samplerCubeArrayShadow`, which GLSL ES 3.00 doesn't have.
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

/**
 * Adds the engine's default precision declarations after `#version 300 es` in both stages
 *
 * Templates can override these defaults with later precision declarations.
 *
 * Warns and leaves the source unchanged when it has no `#version 300 es` marker.
 * @internal
 */
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
