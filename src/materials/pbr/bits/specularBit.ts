import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Rebuilds F0 from the IOR, as `pbrMaterialBit` has already mixed in the metal. The texture's alpha holds
 * the factor, so the tint is divided by it to undo pixi's premultiplied upload before decoding
 * @internal
 */
export const specularBit: ShaderBit = {
  name: 'specular',

  textures: ['specular'],

  bindings: {
    material: {
      specularParams: 'vec4<f32>',
    },
  },

  gpu: {
    fragment: {
      material: /*wgsl*/ `
  {
    let specTex = sampleSpecular(input.vUV);
    let specTexStraight = specTex.rgb / max(specTex.a, 0.001);
    let specTexColor = pow(specTexStraight, vec3<f32>(2.2));
    let specColor = material.specularParams.rgb * specTexColor;
    let specFactor = material.specularParams.w * specTex.a;

    let ior = material.pbrParams.w;
    let iorRatio = (ior - 1.0) / (ior + 1.0);
    let iorF0 = vec3<f32>(iorRatio * iorRatio);
    let dielectricF0 = min(iorF0 * specColor, vec3<f32>(1.0)) * specFactor;

    fresnelF0 = mix(dielectricF0, albedo, metallic);
    f90 = mix(specFactor, 1.0, metallic);
  }
`,
    },
  },

  gl: {
    fragment: {
      material: /*glsl*/ `
  {
    vec4 specTex = sampleSpecular(vUV);
    vec3 specTexStraight = specTex.rgb / max(specTex.a, 0.001);
    vec3 specTexColor = pow(specTexStraight, vec3(2.2));
    vec3 specColor = material.specularParams.rgb * specTexColor;
    float specFactor = material.specularParams.w * specTex.a;

    float ior = material.pbrParams.w;
    float iorRatio = (ior - 1.0) / (ior + 1.0);
    vec3 iorF0 = vec3(iorRatio * iorRatio);
    vec3 dielectricF0 = min(iorF0 * specColor, vec3(1.0)) * specFactor;

    fresnelF0 = mix(dielectricF0, albedo, metallic);
    f90 = mix(specFactor, 1.0, metallic);
  }
`,
    },
  },
};
