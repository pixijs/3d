const OUTPUT_NAME = /^[a-z][A-Za-z0-9]*$/;

/** GLSL ES 3.20 keywords (section 3.7), a superset of 3.00's */
const GLSL_KEYWORDS =
  'const uniform buffer shared coherent volatile restrict readonly writeonly layout centroid flat smooth patch ' +
  'sample invariant precise break continue do for while switch case default if else in out inout int void bool ' +
  'true false float discard return vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3 bvec4 uint uvec2 uvec3 uvec4 mat2 ' +
  'mat3 mat4 mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4 lowp mediump highp precision sampler2D ' +
  'sampler2DShadow sampler2DArray sampler2DArrayShadow isampler2D isampler2DArray usampler2D usampler2DArray ' +
  'sampler2DMS isampler2DMS usampler2DMS sampler2DMSArray isampler2DMSArray usampler2DMSArray sampler3D isampler3D ' +
  'usampler3D samplerCube samplerCubeShadow isamplerCube usamplerCube samplerCubeArray samplerCubeArrayShadow ' +
  'isamplerCubeArray usamplerCubeArray samplerBuffer isamplerBuffer usamplerBuffer image2D iimage2D uimage2D ' +
  'image2DArray iimage2DArray uimage2DArray image3D iimage3D uimage3D imageCube iimageCube uimageCube ' +
  'imageCubeArray iimageCubeArray uimageCubeArray imageBuffer iimageBuffer uimageBuffer struct';

/** GLSL ES 3.20 words reserved for future use (section 3.7) */
const GLSL_RESERVED =
  'attribute varying noperspective subroutine common partition active asm class union enum typedef template this ' +
  'resource goto inline noinline public static extern external interface long short half fixed unsigned superp ' +
  'double input output hvec2 hvec3 hvec4 fvec2 fvec3 fvec4 dvec2 dvec3 dvec4 dmat2 dmat3 dmat4 dmat2x2 dmat2x3 ' +
  'dmat2x4 dmat3x2 dmat3x3 dmat3x4 dmat4x2 dmat4x3 dmat4x4 filter sizeof cast namespace using sampler1D ' +
  'sampler1DShadow sampler1DArray sampler1DArrayShadow isampler1D isampler1DArray usampler1D usampler1DArray ' +
  'sampler2DRect sampler2DRectShadow isampler2DRect usampler2DRect sampler3DRect image1D iimage1D uimage1D ' +
  'image1DArray iimage1DArray uimage1DArray image2DRect iimage2DRect uimage2DRect image2DMS iimage2DMS uimage2DMS ' +
  'image2DMSArray iimage2DMSArray uimage2DMSArray';

/** WGSL keywords ("Keyword Summary") */
const WGSL_KEYWORDS =
  'alias break case const continue continuing default diagnostic discard else enable false fn for if let loop ' +
  'override requires return struct switch true var while';

/** WGSL reserved words ("Reserved Words") */
const WGSL_RESERVED =
  'abstract active alignas alignof as asm async attribute auto await become cast catch class coherent common ' +
  'compile concept consteval constexpr constinit crate debugger decltype delete demote do enum explicit export ' +
  'extends extern external fallthrough filter final finally friend from fxgroup get goto groupshared highp impl ' +
  'implements import inline instanceof interface layout lowp macro match mediump meta mod module move mut mutable ' +
  'namespace new nil noexcept noinline nointerpolation noncoherent noperspective null nullptr of operator package ' +
  'packoffset partition pass patch pixelfragment precise precision premerge priv protected pub public readonly ref ' +
  'regardless register require resource restrict self set shared sizeof smooth snorm static std subroutine super ' +
  'target template this throw trait try type typedef typeid typename typeof union unless unorm unsafe unsized use ' +
  'using varying virtual volatile wgsl where with writeonly yield';

const RESERVED = new Set([GLSL_KEYWORDS, GLSL_RESERVED, WGSL_KEYWORDS, WGSL_RESERVED].join(' ').split(' '));

/**
 * The lowercase start keeps two names off one GLSL output variable, `frag<Name>`
 * @internal
 */
export function assertOutputName(name: string, where: string): void {
  if (!OUTPUT_NAME.test(name)) {
    throw new Error(
      `${where}: '${name}' can't name a fragment output. Start it with a lowercase letter and use only ` +
        'letters and digits, such as "velocity" or "objectId".',
    );
  }
  if (RESERVED.has(name)) {
    throw new Error(
      `${where}: '${name}' can't name a fragment output, because WGSL or GLSL reserves the word. Pick ` +
        'another name, such as one with a prefix.',
    );
  }
}
