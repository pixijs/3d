import type { ShaderBit } from '../ShaderBit';
import { derivativeTangentFrameBit } from './derivativeTangentFrameBit';

/**
 * Declares no `material` fields or textures: it's picked per mesh, after the material's layout is
 * fixed, so `normalScale` and the `normal` texture come from the material bit
 * @internal
 */
export const normalMappingBit: ShaderBit = {
  name: 'normalMapping',

  requires: [derivativeTangentFrameBit],

  gpu: {
    fragment: {
      material: `
  let normalMapSample = sampleNormal(input.vUV).rgb;
  var tangentNormal = normalMapSample * 2.0 - 1.0;
  tangentNormal = vec3<f32>(tangentNormal.xy * material.normalScale, tangentNormal.z);
  let tbnMatrix = calculateTBN(normal, input.vPosition, input.vUV);
  normal = normalize(tbnMatrix * tangentNormal);
`,
    },
  },

  gl: {
    fragment: {
      material: `
  {
  vec3 normalMapSample = sampleNormal(vUV).rgb;
  vec3 tangentNormal = normalMapSample * 2.0 - 1.0;
  tangentNormal.xy *= material.normalScale;
  mat3 tbnMatrix = calculateTBN(normal, vPosition, vUV);
  normal = normalize(tbnMatrix * tangentNormal);
  }
`,
    },
  },
};
