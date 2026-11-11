import type { BillboardMode } from '../../../scene/Mesh3D';
import type { ShaderBit } from '../ShaderBit';

/** Lit only: unlit shaders still write `vNormal`, so the compiler wouldn't drop the work */
const NORMAL_GPU = /*wgsl*/ `
  worldNormal = bbRight * normal.x + bbUp * normal.y + bbNormal * normal.z;
`;

const NORMAL_GL = /*glsl*/ `
  worldNormal = bbRight * normal.x + bbUp * normal.y + bbNormal * normal.z;
`;

function sphericalGpu(lit: boolean): string {
  return /*wgsl*/ `
  let bbRight = vec3<f32>(camera.uViewMatrix[0][0], camera.uViewMatrix[1][0], camera.uViewMatrix[2][0]);
  let bbUp    = vec3<f32>(camera.uViewMatrix[0][1], camera.uViewMatrix[1][1], camera.uViewMatrix[2][1]);
  let bbNormal = cross(bbRight, bbUp);

  let bbScaleX = length(modelMatrix[0].xyz);
  let bbScaleY = length(modelMatrix[1].xyz);
  let bbScaleZ = length(modelMatrix[2].xyz);

  worldPosition = vec4<f32>(
    modelMatrix[3].xyz
      + bbRight * (position.x * bbScaleX)
      + bbUp * (position.y * bbScaleY)
      + bbNormal * (position.z * bbScaleZ),
    1.0
  );
  clipPosition = camera.uViewProjectionMatrix * worldPosition;
${lit ? NORMAL_GPU : ''}`;
}

function sphericalGl(lit: boolean): string {
  return /*glsl*/ `
  vec3 bbRight = vec3(uViewMatrix[0][0], uViewMatrix[1][0], uViewMatrix[2][0]);
  vec3 bbUp    = vec3(uViewMatrix[0][1], uViewMatrix[1][1], uViewMatrix[2][1]);
  vec3 bbNormal = cross(bbRight, bbUp);

  float bbScaleX = length(modelMatrix[0].xyz);
  float bbScaleY = length(modelMatrix[1].xyz);
  float bbScaleZ = length(modelMatrix[2].xyz);

  worldPosition = vec4(
    modelMatrix[3].xyz
      + bbRight * (position.x * bbScaleX)
      + bbUp * (position.y * bbScaleY)
      + bbNormal * (position.z * bbScaleZ),
    1.0
  );
  gl_Position = uViewProjectionMatrix * worldPosition;
${lit ? NORMAL_GL : ''}`;
}

function cylindricalGpu(lit: boolean): string {
  return /*wgsl*/ `
  let bbColX = modelMatrix[0].xyz;
  let bbColY = modelMatrix[1].xyz;
  let bbScaleX = length(bbColX);
  let bbScaleY = length(bbColY);
  let bbScaleZ = length(modelMatrix[2].xyz);
  let bbCentre = modelMatrix[3].xyz;

  var bbUp = vec3<f32>(0.0, 1.0, 0.0);
  if (bbScaleY > 1e-8) { bbUp = bbColY / bbScaleY; }

  let bbToCam = camera.uCameraPosition - bbCentre;
  let bbFlat = bbToCam - bbUp * dot(bbToCam, bbUp);
  let bbFlatLenSq = dot(bbFlat, bbFlat);

  var bbRight = vec3<f32>(1.0, 0.0, 0.0);
  if (bbFlatLenSq > 1e-8) {
    bbRight = cross(bbUp, bbFlat) * inverseSqrt(bbFlatLenSq);
  } else if (bbScaleX > 1e-8) {
    bbRight = bbColX / bbScaleX;
  }

  let bbNormal = cross(bbRight, bbUp);

  worldPosition = vec4<f32>(
    bbCentre
      + bbRight * (position.x * bbScaleX)
      + bbUp * (position.y * bbScaleY)
      + bbNormal * (position.z * bbScaleZ),
    1.0
  );
  clipPosition = camera.uViewProjectionMatrix * worldPosition;
${lit ? NORMAL_GPU : ''}`;
}

function cylindricalGl(lit: boolean): string {
  return /*glsl*/ `
  vec3 bbColX = modelMatrix[0].xyz;
  vec3 bbColY = modelMatrix[1].xyz;
  float bbScaleX = length(bbColX);
  float bbScaleY = length(bbColY);
  float bbScaleZ = length(modelMatrix[2].xyz);
  vec3 bbCentre = modelMatrix[3].xyz;

  vec3 bbUp = vec3(0.0, 1.0, 0.0);
  if (bbScaleY > 1e-8) { bbUp = bbColY / bbScaleY; }

  vec3 bbToCam = uCameraPosition - bbCentre;
  vec3 bbFlat = bbToCam - bbUp * dot(bbToCam, bbUp);
  float bbFlatLenSq = dot(bbFlat, bbFlat);

  vec3 bbRight = vec3(1.0, 0.0, 0.0);
  if (bbFlatLenSq > 1e-8) {
    bbRight = cross(bbUp, bbFlat) * inversesqrt(bbFlatLenSq);
  } else if (bbScaleX > 1e-8) {
    bbRight = bbColX / bbScaleX;
  }

  vec3 bbNormal = cross(bbRight, bbUp);

  worldPosition = vec4(
    bbCentre
      + bbRight * (position.x * bbScaleX)
      + bbUp * (position.y * bbScaleY)
      + bbNormal * (position.z * bbScaleZ),
    1.0
  );
  gl_Position = uViewProjectionMatrix * worldPosition;
${lit ? NORMAL_GL : ''}`;
}

const cache: Partial<Record<string, ShaderBit>> = Object.create(null);

/**
 * Rewrites `worldPosition` and the clip position in the vertex `afterTransform` slot, so it goes ahead of any bit that
 * reads them there
 * @internal
 */
export function getMeshBillboardBit(mode: BillboardMode, lit: boolean): ShaderBit {
  const key = `${mode}:${lit}`;
  const existing = cache[key];
  if (existing) return existing;

  if (mode === 'none') {
    throw new Error("[meshBillboardBits] billboardMode 'none' has no bit — the caller must skip injection.");
  }

  const spherical = mode === 'spherical';
  const bit: ShaderBit = {
    name: `meshBillboard${spherical ? 'Spherical' : 'Cylindrical'}${lit ? 'Lit' : ''}`,
    gpu: { vertex: { afterTransform: spherical ? sphericalGpu(lit) : cylindricalGpu(lit) } },
    gl: { vertex: { afterTransform: spherical ? sphericalGl(lit) : cylindricalGl(lit) } },
  };

  cache[key] = bit;
  return bit;
}
