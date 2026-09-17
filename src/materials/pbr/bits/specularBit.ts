import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * KHR_materials_specular shader bit
 *
 * Overrides the dielectric F0 and F90 that `pbrMaterialBit` derives from IOR.
 * The extension lets authors:
 *
 *  - **Dim the dielectric specular lobe** via `specularFactor` ∈ [0, 1].
 *    `0` gives a purely diffuse dielectric (no mirror reflection); `1` keeps
 *    the default PBR behaviour. Metals are unaffected because their F0 comes
 *    from `baseColor` — the mix below lerps metals back to their standard
 *    `baseColor` F0 / F90 = 1.
 *  - **Tint dielectric F0** via `specularColorFactor` (and the optional RGB
 *    channel of the specular texture). Useful for varnish, silk, or the small
 *    chromatic offset seen on some dielectrics at grazing angles.
 *
 * Writes to the `material` slot — runs AFTER `pbrMaterialBit` (which has
 * already set `fresnelF0 = mix(iorF0, albedo, metallic)` and `f90 = 1.0`) and
 * BEFORE `iridescenceBit` / `iblBit` / `pbrLightingBit`, so the specular-
 * modified F0 is what the thin-film model sees and what both IBL and direct
 * lighting consume. Pure overwrite: reconstructs the dielectric endpoint from
 * IOR, applies the extension's factor/color modulators, then re-does the metal
 * mix. `f90` is reconstructed the same way (0→1 on dielectrics, clamped to 1
 * on metals).
 *
 * Spec formulas, from
 * https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_specular:
 *
 *   dielectricF0 = min(iorF0 * specularColorFactor * texture.rgb, 1) * specularFactor * texture.a
 *   fresnelF0    = mix(dielectricF0, baseColor, metallic)
 *   f90          = mix(specularFactor * texture.a, 1, metallic)
 *
 * ## Single packed texture slot (RGB = color, A = factor)
 *
 * The glTF spec defines two binding points (`specularTexture` sampled from A,
 * `specularColorTexture` sampled from RGB). Authoring tools and every Khronos
 * sample asset pack both into one RGBA image, matching the precedent set by
 * `sheenBit` / `iridescenceBit`. One slot: `.rgb` modulates
 * colour, `.a` modulates factor. The packed texture is loaded as sRGB (for
 * the RGB channels); alpha is colour-space-invariant so the factor channel
 * decodes linearly automatically.
 *
 * `Texture.WHITE` decodes to `(1, 1, 1, 1)` so factor-only materials behave
 * identically to the factor-only spec path without a texture branch.
 *
 * If a pathological asset supplies two *different* texture references,
 * `processMaterials.ts` warns and uses the colour texture (its alpha then
 * drives factor — typically 1.0 for an sRGB colour image, giving the
 * factor-only fallback).
 *
 * ## Premultiplied-alpha undo
 *
 * Same treatment as `sheenBit`: pixi's default upload premultiplies RGB by
 * alpha, but here alpha is a separate data channel (specular factor), not
 * coverage. Undo the premultiplication before the gamma 2.2 sRGB decode so
 * the colour channel doesn't get scaled by factor.
 *
 * ## Per-material data
 *
 * Packed into one `vec4<f32>` (`specularParams`):
 *
 * | channel | meaning                                   |
 * |---------|-------------------------------------------|
 * | `.x`    | specularColorFactor R                     |
 * | `.y`    | specularColorFactor G                     |
 * | `.z`    | specularColorFactor B                     |
 * | `.w`    | specularFactor (dielectric lobe strength) |
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
  // KHR_materials_specular — see specularBit.ts for packing / colour-space rationale.
  {
    let specTex = sampleSpecular(input.vUV);
    // Undo premultiplied-alpha upload (alpha here is the factor mask, not
    // coverage), then gamma 2.2 sRGB decode — same pattern as sheenBit.
    let specTexStraight = specTex.rgb / max(specTex.a, 0.001);
    let specTexColor = pow(specTexStraight, vec3<f32>(2.2));
    let specColor = material.specularParams.rgb * specTexColor;
    let specFactor = material.specularParams.w * specTex.a;

    // Rebuild the dielectric endpoint from IOR (pbrMaterialBit already did
    // this once, but overwrote fresnelF0 with the metal mix afterwards).
    let ior = material.pbrParams.w;
    let iorRatio = (ior - 1.0) / (ior + 1.0);
    let iorF0 = vec3<f32>(iorRatio * iorRatio);
    let dielectricF0 = min(iorF0 * specColor, vec3<f32>(1.0)) * specFactor;

    // Re-do the metal blend — metals keep their baseColor F0 unchanged.
    fresnelF0 = mix(dielectricF0, albedo, metallic);
    f90 = mix(specFactor, 1.0, metallic);
  }
`,
    },
  },

  gl: {
    fragment: {
      material: /*glsl*/ `
  // KHR_materials_specular — see specularBit.ts for packing / colour-space rationale.
  {
    vec4 specTex = sampleSpecular(vUV);
    // Undo premultiplied-alpha upload + gamma 2.2 sRGB decode — same pattern
    // as sheenBit.
    vec3 specTexStraight = specTex.rgb / max(specTex.a, 0.001);
    vec3 specTexColor = pow(specTexStraight, vec3(2.2));
    vec3 specColor = material.specularParams.rgb * specTexColor;
    float specFactor = material.specularParams.w * specTex.a;

    // Rebuild the dielectric endpoint from IOR (pbrMaterialBit overwrote
    // fresnelF0 with the metal mix).
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
