import type { ShaderBit } from '../../../core/shader/ShaderBit';

// Tuning baked as header constants (WGSL `const` + GLSL `#define`) so the bit
// needs no per-material uniforms. F0 a touch above the dielectric 0.04 for pop;
// a low roughness keeps the reflection sharp; intensity scales the whole add.
const GPU_HEADER = /*wgsl*/ `
const GLOSS_F0: f32 = 0.08;
const GLOSS_ROUGHNESS: f32 = 0.06;
const GLOSS_INTENSITY: f32 = 0.7;
`;

const GL_HEADER = /*glsl*/ `
#ifndef PIXI3D_GLOSS_DEFINED
#define PIXI3D_GLOSS_DEFINED
#define GLOSS_F0 0.08
#define GLOSS_ROUGHNESS 0.06
#define GLOSS_INTENSITY 0.7
#endif
`;

const FRAGMENT = /*wgsl*/ `
  // Edge-biased glossy coat: a sharp environment reflection, Fresnel-weighted so
  // it peaks on the rounded edges, added over the PBR result.
  let glossNdotV = max(dot(normal, viewDir), 0.0);
  let glossFresnel = GLOSS_F0 + (1.0 - GLOSS_F0) * pow(1.0 - glossNdotV, 5.0);
  let glossRefl = sampleEnvironment(reflect(-viewDir, normal), GLOSS_ROUGHNESS);
  finalColor += glossRefl * (glossFresnel * GLOSS_INTENSITY);
`;

const FRAGMENT_GL = /*glsl*/ `
  float glossNdotV = max(dot(normal, viewDir), 0.0);
  float glossFresnel = GLOSS_F0 + (1.0 - GLOSS_F0) * pow(1.0 - glossNdotV, 5.0);
  vec3 glossRefl = sampleEnvironment(reflect(-viewDir, normal), GLOSS_ROUGHNESS);
  finalColor += glossRefl * (glossFresnel * GLOSS_INTENSITY);
`;

/**
 * Stylised wet-plastic gloss: a Fresnel-weighted sharp environment reflection added after lighting
 *
 * Compose it onto a lit material via `extraBits`. It runs in the post-lighting slot, where
 * `finalColor`, the surface `normal` and `viewDir`, and `sampleEnvironment` are in scope, the
 * same place clearcoat composites its lobe. Deliberately not a physical lobe: an edge-biased
 * sheen that rounded edges carry, for a slick just-unboxed look. Tuning is baked as header
 * constants until per-material bit parameters land.
 * @category extras:materials
 * @advanced
 */
export const glossBit: ShaderBit = {
  name: 'gloss',
  gpu: {
    header: GPU_HEADER,
    fragment: { lobePostLighting: FRAGMENT },
  },
  gl: {
    fragment: { header: GL_HEADER, lobePostLighting: FRAGMENT_GL },
  },
};
