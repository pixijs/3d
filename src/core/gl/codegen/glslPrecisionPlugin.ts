import { warn } from 'pixi.js';

import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

const VERSION_LINE = '#version 300 es';

/**
 * Default precision declarations for GLSL ES 3.00 shaders compiled by `compileGlslSource`
 *
 * Fragment shaders have no default float precision, default ints to `mediump`,
 * and predeclare `sampler2D` and `samplerCube` as `lowp`. Other sampler types
 * have no default precision. Explicit `highp` defaults keep integer bit maths
 * and floating-point data texture reads within the ranges the engine requires.
 * GLSL ES 3.00 guarantees `highp` support for these types in both stages.
 *
 * The prelude lists the GLSL ES 3.00 sampler types used by the engine.
 * `samplerCubeArray*` arrived later and would be a compile error here.
 */
const GLSL_PRECISION_PRELUDE = `precision highp float;
precision highp int;
precision highp sampler2D;
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
