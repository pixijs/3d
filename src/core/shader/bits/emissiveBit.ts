import type { ShaderBit } from '../ShaderBit';

/**
 * Owns the self-illumination term
 *
 * Kept separate from `pbrMaterialBit` so that materials with no emissive
 * contribution (the common case) don't pay for the material-struct read, the
 * `sampleEmissive` texture fetch, or the strength multiplier.
 *
 * Writes to the `material` slot — runs AFTER `pbrMaterialBit` (which declares
 * `var emissive: vec3<f32> = vec3(0)` as the neutral no-op default) and
 * BEFORE `pbrLightingBit` (which adds `emissive` into `finalColor`). This
 * bit *assigns* the already-declared variable rather than re-declaring it,
 * mirroring the way `pbrMaterialBit` overwrites its own `metallic`/`roughness`
 * defaults from the material struct.
 *
 * ## KHR_materials_emissive_strength
 *
 * Core glTF clamps `emissiveFactor` to [0, 1]. This extension lifts the
 * clamp via a scalar `emissiveStrength` multiplier (default 1.0), letting
 * authored assets push past 1.0 for HDR / bloom — necessary for tone-mapped
 * rendering of neon signs, screens, glowing lava, etc. The multiplier is
 * applied before tone mapping (ACES is downstream in the bit list), so
 * high-strength values get lifted into the tone-mapping shoulder and
 * preserve hue.
 *
 * Default `emissiveStrength = 1.0` is bit-identical to core-glTF output —
 * same pattern as `KHR_materials_ior`, where the default IOR 1.5 reproduces
 * the spec's F0 = 0.04.
 * @internal
 */
export const emissiveBit: ShaderBit = {
  name: 'emissive',
  textures: ['emissive'],
  bindings: {
    material: {
      emissive: 'vec3<f32>',
      emissiveStrength: 'f32',
    },
  },
  gpu: {
    fragment: {
      material: /*wgsl*/ `
  // Assign into the emissive var declared by pbrMaterialBit's defaults.
  emissive = material.emissive * material.emissiveStrength;
  // Unbound emissive slot resolves to the reserved white slot (returned as 1.0
  // by the batch-texture getter without sampling), so this is a no-op when no
  // texture is set — no HAS_UVS gate, matching the GL hook and pbrMaterialBit.
  let emissiveTex = sampleEmissive(input.vUV).rgb;
  emissive *= pow(emissiveTex, vec3<f32>(2.2));
`,
    },
  },
  gl: {
    fragment: {
      material: /*glsl*/ `
  emissive = material.emissive * material.emissiveStrength;
  vec3 emissiveTex = sampleEmissive(vUV).rgb;
  emissive *= pow(emissiveTex, vec3(2.2));
`,
    },
  },
};
