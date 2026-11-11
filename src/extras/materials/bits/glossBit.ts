import type { ShaderBit } from '../../../core/shader/ShaderBit';

const GPU_HEADER = /*wgsl*/ `
const GLOSS_F0: f32 = 0.08;
const GLOSS_ROUGHNESS: f32 = 0.06;
const GLOSS_INTENSITY: f32 = 0.7;
`;

const GL_HEADER = /*glsl*/ `
#define GLOSS_F0 0.08
#define GLOSS_ROUGHNESS 0.06
#define GLOSS_INTENSITY 0.7
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
 * Stylised wet-plastic gloss: a sharp reflection of the environment, strongest at grazing angles,
 * added on top of lighting
 *
 * Add it to a {@link Material3D} or {@link PhongMaterial} through `extraBits`. It reflects
 * {@link View3D#environment}, so a view without one shows no gloss. Its strength and sharpness are
 * fixed, with nothing to set per material. For a physically based coat, use the `clearcoat` option
 * of {@link Material3D} instead.
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
