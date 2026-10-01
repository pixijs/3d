import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * `KHR_materials_specular`: scales and tints the dielectric part of the specular reflection
 *
 * `specularParams` holds the tint in `.rgb` and the factor in `.w`. The factor dims the dielectric
 * reflection, from 1 (standard PBR) to 0 (none at all), and the tint colours it. Metals keep
 * `baseColor` as their F0 and 1 as their F90. Following the spec
 * (https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_specular):
 *
 *     dielectricF0 = min(iorF0 * color * texture.rgb, 1) * factor * texture.a
 *     fresnelF0    = mix(dielectricF0, albedo, metallic)
 *     f90          = mix(factor * texture.a, 1, metallic)
 *
 * It runs in the `material` slot after `pbrMaterialBit`, which has already mixed the metal into
 * `fresnelF0`, so it rebuilds the F0 from IOR and mixes again. It must come before
 * `iridescenceBit`, which takes this F0 as its base, and before the lighting bits read it.
 *
 * One texture slot stands in for the spec's two textures: `.rgb` is the tint, sRGB-decoded in the
 * shader, and `.a` the factor. Assets pack them that way; when a glTF names two different images,
 * the loader warns and keeps the colour one. Alpha here is data, not coverage, so the shader undoes
 * pixi's premultiplied upload before decoding the colour, as `sheenBit` does.
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
