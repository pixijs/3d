import type { ShaderBit } from '../../../core/shader/ShaderBit';

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
 * sheen that rounded edges carry, for a slick just-unboxed look.
 *
 * The tuning is fixed in shader constants, so the bit needs no per-material uniforms.
 * `GLOSS_F0` sits a touch above a plain dielectric's 0.04 so the edges catch more light,
 * `GLOSS_ROUGHNESS` is low to keep the reflection sharp, and `GLOSS_INTENSITY` scales the whole
 * addition.
 * @example
 * ```ts
 * const plastic = new Material3D({ baseColor: 0xe94f37, roughness: 0.6, extraBits: [glossBit] });
 * ```
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
