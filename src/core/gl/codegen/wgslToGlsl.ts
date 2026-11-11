import type { InterStageType } from '../../shader/ShaderBit';

/** @internal */
export const WGSL_TO_GLSL_TYPE: Readonly<Record<InterStageType, string>> = {
  f32: 'float',
  i32: 'int',
  u32: 'uint',

  'vec2<f32>': 'vec2',
  'vec3<f32>': 'vec3',
  'vec4<f32>': 'vec4',

  'vec2<i32>': 'ivec2',
  'vec3<i32>': 'ivec3',
  'vec4<i32>': 'ivec4',

  'vec2<u32>': 'uvec2',
  'vec3<u32>': 'uvec3',
  'vec4<u32>': 'uvec4',
};

/**
 * `''` marks a WGSL sampler, which GLSL folds into its texture. Every sampler type here but `samplerCubeArrayShadow`,
 * which GLSL ES 3.00 lacks, needs a line in `GLSL_PRECISION_PRELUDE` in `glslPrecisionPlugin.ts`.
 * @internal
 */
export const WGSL_TO_GLSL_BINDING_TYPE: Readonly<Record<string, string>> = {
  ...WGSL_TO_GLSL_TYPE,
  bool: 'bool',

  'mat2x2<f32>': 'mat2',
  'mat3x3<f32>': 'mat3',
  'mat4x4<f32>': 'mat4',
  'mat2x3<f32>': 'mat2x3',
  'mat2x4<f32>': 'mat2x4',
  'mat3x2<f32>': 'mat3x2',
  'mat3x4<f32>': 'mat3x4',
  'mat4x2<f32>': 'mat4x2',
  'mat4x3<f32>': 'mat4x3',

  'texture_2d<f32>': 'sampler2D',
  'texture_2d<u32>': 'usampler2D',
  'texture_2d<i32>': 'isampler2D',
  'texture_2d_array<f32>': 'sampler2DArray',
  'texture_3d<f32>': 'sampler3D',
  'texture_cube<f32>': 'samplerCube',
  texture_depth_2d: 'sampler2DShadow',
  texture_depth_2d_array: 'sampler2DArrayShadow',
  texture_depth_cube: 'samplerCubeShadow',
  texture_depth_cube_array: 'samplerCubeArrayShadow',

  sampler: '',
  sampler_comparison: '',
};
