import type { ShaderBit } from '../../core/shader/ShaderBit';
import type { RibbonWidthUnits } from './RibbonGeometry';

/**
 * Half the width in world units, from the signed full width in `aRibbon.w`. A world width is a local length, so it
 * divides by the length of the side in local units (`normalScale` inverts a rotation and scale, as the template's
 * normals assume); a pixel width divides by the pixels one world unit along the side spans there
 */
const HALF_WIDTH_GPU: Record<RibbonWidthUnits, string> = {
  world: /* wgsl */ `let rbHalf = input.aRibbon.w * 0.5 / length((rbSide * modelMatrix3) * normalScale);`,
  pixels: /* wgsl */ `
  let rbClipSide = camera.uViewProjectionMatrix * vec4<f32>(rbSide, 0.0);
  let rbW = max(abs(clipPosition.w), 1e-6);
  let rbPixels = (rbClipSide.xy * rbW - clipPosition.xy * rbClipSide.w) / (rbW * rbW) * camera.uFrameSize * 0.5;
  let rbHalf = input.aRibbon.w * 0.5 / max(length(rbPixels), 1e-6);`,
};

const HALF_WIDTH_GL: Record<RibbonWidthUnits, string> = {
  world: /* glsl */ `float rbHalf = aRibbon.w * 0.5 / length((rbSide * modelMatrix3) * normalScale);`,
  pixels: /* glsl */ `
  vec4 rbClipSide = uViewProjectionMatrix * vec4(rbSide, 0.0);
  float rbW = max(abs(gl_Position.w), 1e-6);
  vec2 rbPixels = (rbClipSide.xy * rbW - gl_Position.xy * rbClipSide.w) / (rbW * rbW) * uFrameSize * 0.5;
  float rbHalf = aRibbon.w * 0.5 / max(length(rbPixels), 1e-6);`,
};

function ribbonGpu(units: RibbonWidthUnits): string {
  return /* wgsl */ `{
  let rbTangent = modelMatrix3 * input.aRibbon.xyz;
  let rbBack = vec3<f32>(camera.uViewMatrix[0][2], camera.uViewMatrix[1][2], camera.uViewMatrix[2][2]);
  let rbRight = vec3<f32>(camera.uViewMatrix[0][0], camera.uViewMatrix[1][0], camera.uViewMatrix[2][0]);
  let rbToCamera = mix(camera.uCameraPosition - worldPosition.xyz, rbBack, camera.uProjectionMatrix[3][3]);
  let rbCross = cross(rbTangent, rbToCamera);
  let rbCrossSq = dot(rbCross, rbCross);
  let rbSide = select(
    rbRight,
    rbCross * inverseSqrt(max(rbCrossSq, 1e-30)),
    rbCrossSq > 1e-12 * dot(rbTangent, rbTangent) * dot(rbToCamera, rbToCamera)
  );
  ${HALF_WIDTH_GPU[units]}
  worldPosition = vec4<f32>(worldPosition.xyz + rbSide * rbHalf, 1.0);
  clipPosition = camera.uViewProjectionMatrix * worldPosition;
  let rbView = normalize(rbToCamera);
  let rbAlong = rbTangent * inverseSqrt(max(dot(rbTangent, rbTangent), 1e-30));
  let rbAcross = rbView - rbAlong * dot(rbAlong, rbView);
  worldNormal = normalize(rbAcross + rbView * (1.0 - length(rbAcross))) + rbSide * sign(input.aRibbon.w);
}`;
}

function ribbonGl(units: RibbonWidthUnits): string {
  return /* glsl */ `{
  vec3 rbTangent = modelMatrix3 * aRibbon.xyz;
  vec3 rbBack = vec3(uViewMatrix[0][2], uViewMatrix[1][2], uViewMatrix[2][2]);
  vec3 rbRight = vec3(uViewMatrix[0][0], uViewMatrix[1][0], uViewMatrix[2][0]);
  vec3 rbToCamera = mix(uCameraPosition - worldPosition.xyz, rbBack, uProjectionMatrix[3][3]);
  vec3 rbCross = cross(rbTangent, rbToCamera);
  float rbCrossSq = dot(rbCross, rbCross);
  vec3 rbSide = rbCrossSq > 1e-12 * dot(rbTangent, rbTangent) * dot(rbToCamera, rbToCamera)
    ? rbCross * inversesqrt(max(rbCrossSq, 1e-30))
    : rbRight;
  ${HALF_WIDTH_GL[units]}
  worldPosition = vec4(worldPosition.xyz + rbSide * rbHalf, 1.0);
  gl_Position = uViewProjectionMatrix * worldPosition;
  vec3 rbView = normalize(rbToCamera);
  vec3 rbAlong = rbTangent * inversesqrt(max(dot(rbTangent, rbTangent), 1e-30));
  vec3 rbAcross = rbView - rbAlong * dot(rbAlong, rbView);
  worldNormal = normalize(rbAcross + rbView * (1.0 - length(rbAcross))) + rbSide * sign(aRibbon.w);
}`;
}

/**
 * Rewrites `worldPosition`, the clip position and `worldNormal` after the transform, as the billboard bit does;
 * `'shape'` keeps it in shadows. The normal leans to the view where the line points at the camera, as its side flips
 * @internal
 */
export const ribbonBits: Record<RibbonWidthUnits, ShaderBit> = {
  world: {
    name: 'ribbonWorld',
    level: 'shape',
    attributes: { aRibbon: 'float32x4' },
    gpu: { vertex: { afterTransform: ribbonGpu('world') } },
    gl: { vertex: { afterTransform: ribbonGl('world') } },
  },
  pixels: {
    name: 'ribbonPixels',
    level: 'shape',
    attributes: { aRibbon: 'float32x4' },
    gpu: { vertex: { afterTransform: ribbonGpu('pixels') } },
    gl: { vertex: { afterTransform: ribbonGl('pixels') } },
  },
};
