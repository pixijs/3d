import type { RibbonWidthUnits } from '../../../geometry/RibbonGeometry';
import type { ShaderBit } from '../ShaderBit';

/**
 * The world half-width at the point, from the signed full width in `aRibbon.w`; pixels divide by how many pixels one
 * world unit along the side spans there, measured from the side's clip-space derivative
 */
const HALF_WIDTH_GPU: Record<RibbonWidthUnits, string> = {
  world: /* wgsl */ `let rbHalf = input.aRibbon.w * 0.5;`,
  pixels: /* wgsl */ `
  let rbClip = camera.uViewProjectionMatrix * vec4<f32>(rbWorld, 1.0);
  let rbClipSide = camera.uViewProjectionMatrix * vec4<f32>(rbSide, 0.0);
  let rbW = max(abs(rbClip.w), 1e-6);
  let rbPixels = (rbClipSide.xy * rbW - rbClip.xy * rbClipSide.w) / (rbW * rbW) * camera.uViewportSize * 0.5;
  let rbHalf = input.aRibbon.w * 0.5 / max(length(rbPixels), 1e-6);`,
};

const HALF_WIDTH_GL: Record<RibbonWidthUnits, string> = {
  world: /* glsl */ `float rbHalf = aRibbon.w * 0.5;`,
  pixels: /* glsl */ `
  vec4 rbClip = uViewProjectionMatrix * vec4(rbWorld, 1.0);
  vec4 rbClipSide = uViewProjectionMatrix * vec4(rbSide, 0.0);
  float rbW = max(abs(rbClip.w), 1e-6);
  vec2 rbPixels = (rbClipSide.xy * rbW - rbClip.xy * rbClipSide.w) / (rbW * rbW) * uViewportSize * 0.5;
  float rbHalf = aRibbon.w * 0.5 / max(length(rbPixels), 1e-6);`,
};

function ribbonGpu(units: RibbonWidthUnits): string {
  return /* wgsl */ `{
  let rbC0 = modelMatrix[0].xyz;
  let rbC1 = modelMatrix[1].xyz;
  let rbC2 = modelMatrix[2].xyz;
  let rbInverse = transpose(mat3x3<f32>(cross(rbC1, rbC2), cross(rbC2, rbC0), cross(rbC0, rbC1)))
    * (1.0 / dot(rbC0, cross(rbC1, rbC2)));
  let rbWorld = (modelMatrix * position).xyz;
  let rbTangent = mat3x3<f32>(rbC0, rbC1, rbC2) * input.aRibbon.xyz;
  let rbBack = vec3<f32>(camera.uViewMatrix[0][2], camera.uViewMatrix[1][2], camera.uViewMatrix[2][2]);
  let rbRight = vec3<f32>(camera.uViewMatrix[0][0], camera.uViewMatrix[1][0], camera.uViewMatrix[2][0]);
  let rbToCamera = mix(camera.uCameraPosition - rbWorld, rbBack, camera.uProjectionMatrix[3][3]);
  let rbCross = cross(rbTangent, rbToCamera);
  let rbCrossSq = dot(rbCross, rbCross);
  let rbSide = select(
    rbRight,
    rbCross * inverseSqrt(max(rbCrossSq, 1e-30)),
    rbCrossSq > 1e-12 * dot(rbTangent, rbTangent) * dot(rbToCamera, rbToCamera)
  );
  ${HALF_WIDTH_GPU[units]}
  position = vec4<f32>(position.xyz + rbInverse * (rbSide * rbHalf), position.w);
  let rbFacing = cross(rbSide, rbTangent);
  let rbNormal = rbFacing * inverseSqrt(max(dot(rbFacing, rbFacing), 1e-30)) + rbSide * sign(input.aRibbon.w);
  normal = (rbInverse * rbNormal) * vec3<f32>(dot(rbC0, rbC0), dot(rbC1, rbC1), dot(rbC2, rbC2));
}`;
}

function ribbonGl(units: RibbonWidthUnits): string {
  return /* glsl */ `{
  vec3 rbC0 = modelMatrix[0].xyz;
  vec3 rbC1 = modelMatrix[1].xyz;
  vec3 rbC2 = modelMatrix[2].xyz;
  mat3 rbInverse = transpose(mat3(cross(rbC1, rbC2), cross(rbC2, rbC0), cross(rbC0, rbC1)))
    * (1.0 / dot(rbC0, cross(rbC1, rbC2)));
  vec3 rbWorld = (modelMatrix * position).xyz;
  vec3 rbTangent = mat3(rbC0, rbC1, rbC2) * aRibbon.xyz;
  vec3 rbBack = vec3(uViewMatrix[0][2], uViewMatrix[1][2], uViewMatrix[2][2]);
  vec3 rbRight = vec3(uViewMatrix[0][0], uViewMatrix[1][0], uViewMatrix[2][0]);
  vec3 rbToCamera = mix(uCameraPosition - rbWorld, rbBack, uProjectionMatrix[3][3]);
  vec3 rbCross = cross(rbTangent, rbToCamera);
  float rbCrossSq = dot(rbCross, rbCross);
  vec3 rbSide = rbCrossSq > 1e-12 * dot(rbTangent, rbTangent) * dot(rbToCamera, rbToCamera)
    ? rbCross * inversesqrt(max(rbCrossSq, 1e-30))
    : rbRight;
  ${HALF_WIDTH_GL[units]}
  position = vec4(position.xyz + rbInverse * (rbSide * rbHalf), position.w);
  vec3 rbFacing = cross(rbSide, rbTangent);
  vec3 rbNormal = rbFacing * inversesqrt(max(dot(rbFacing, rbFacing), 1e-30)) + rbSide * sign(aRibbon.w);
  normal = (rbInverse * rbNormal) * vec3(dot(rbC0, rbC0), dot(rbC1, rbC1), dot(rbC2, rbC2));
}`;
}

/**
 * Runs in the vertex `input` slot after skinning, so every pass template declares `modelMatrix`, `position` and
 * `normal` before `{{input}}`; it writes both in local space, through the inverse of `modelMatrix`, as they transform after
 * @internal
 */
export const ribbonBits: Record<RibbonWidthUnits, ShaderBit> = {
  world: {
    name: 'ribbonWorld',
    attributes: { aRibbon: 'float32x4' },
    gpu: { vertex: { input: ribbonGpu('world') } },
    gl: { vertex: { input: ribbonGl('world') } },
  },
  pixels: {
    name: 'ribbonPixels',
    attributes: { aRibbon: 'float32x4' },
    gpu: { vertex: { input: ribbonGpu('pixels') } },
    gl: { vertex: { input: ribbonGl('pixels') } },
  },
};
