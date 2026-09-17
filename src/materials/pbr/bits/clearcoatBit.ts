import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * KHR_materials_clearcoat — a thin transparent lacquer layer on top of the base PBR material
 *
 * The clearcoat layer has its own GGX specular lobe (with `F0 = 0.04`,
 * dielectric IOR ≈ 1.5), its own roughness, and an optional independent
 * normal map.
 *
 * ## Two construction-selected variants
 *
 * Built via `createClearcoatBit`, which emits one of two variants picked
 * at material-construction time (like `getPositionBit` per vertex format,
 * or the base `normalMappingBit` per `normalTexture`):
 *
 *  - **`clearcoat`** (no coat normal map — the common case): the coat frame is
 *    just the geometric surface normal, so there is no TBN to build and no coat
 *    normal texture to sample. Cheaper per fragment — relevant on mobile.
 *  - **`clearcoat:normalMap`**: samples the coat normal map and builds a
 *    derivative-based TBN, exactly as before.
 *
 * Both carry the identical `clearcoatParams` struct binding, so the packed
 * Material layout is the same regardless of variant.
 *
 * ## Double-sided back faces
 *
 * The coat frame is anchored to the *geometric* normal (`vNormal`), not the
 * base-material `normal` — the coat's optional normal map is independent of the
 * base normal map, so reusing the base (possibly base-normal-mapped) `normal`
 * would be wrong. But `vNormal` is the raw interpolated varying, which is NOT
 * flipped on back faces (only the base `normal` is, by `doubleSidedNormalBit`).
 * So both variants front-facing-correct it themselves
 * (`select(-vNormal, vNormal, frontFacing)` / `gl_FrontFacing ? vNormal : -vNormal`).
 * Without this, a double-sided coat reflects the *opposite* hemisphere of the
 * environment on its back faces, and `ccNDotV` collapses to grazing (maximal
 * reflection) — a bright, wrong reflection. `frontFacing` is always available as
 * a fragment builtin, so this needs no extra gating.
 *
 * ## Architecture: a "lobe" emitted into the existing light loop
 *
 * Clearcoat is *not* a second lighting model — it splices three snippets
 * into `pbrLightingBit`'s loop via the lobe convention documented on
 * {@link createLightingBit}:
 *
 *  - `lobePreLighting`  — declare clearcoat normal/roughness/Fresnel hoists.
 *  - `lobePerLight`     — accumulate clearcoat specular for this light.
 *  - `lobePostLighting` — composite: attenuate base lobe by clearcoat
 *                         Fresnel, add clearcoat direct + IBL specular.
 *
 * So a material with clearcoat still runs **one** light loop, samples each
 * shadow map exactly **once**, and pays only the per-iteration cost of an
 * extra GGX evaluation. There is no second `for (i in lights)` and no
 * second shadow lookup.
 *
 * The clearcoat lobe also contributes its own image-based specular,
 * sampling whichever environment source is active via `sampleEnvironment`.
 * Without this, glossy lacquer would only ever *darken* the substrate
 * (Fresnel attenuation) without adding back its own environment reflection
 * — the surface would look lifeless under image-based lighting.
 *
 * ## Required upstream state
 *
 * Set by `pbrMaterialBit` and `pbrLightingBit` before this bit runs:
 *   - `material`               — Material struct (needs `clearcoatParams`)
 *   - `normal`, `viewDir`      — surface frame
 *   - `finalColor`             — base PBR result, attenuated in `lobePostLighting`
 *   - `INV_PI`                 — declared by pbrLightingBit's header
 *   - `input.vUV` / `vUV`      — texture coordinates
 *
 * ## Constants
 *
 * The dielectric Fresnel `CLEARCOAT_F0 = 0.04` (IOR ≈ 1.5) is fixed by the
 * glTF spec. We declare it as a `const` in the WGSL header and `#define` in
 * the GLSL header — *not* as a shader override — because pixi-3d's GLSL
 * backend doesn't translate WGSL `override`s to GLSL `#define`s. Using a
 * literal constant keeps both backends symmetric without needing a separate
 * `glslOverridesPlugin`.
 *
 * The TBN helper (coat-normal-map variant only) is named `calculateClearcoatTBN`
 * (not `calculateTBN`) so a material that uses both base normal mapping AND a
 * clearcoat normal map doesn't redeclare the same identifier as
 * `normalMappingBit`. The WGSL body negates `dpdy()` for the same window-Y
 * convention reason documented on `normalMappingBit` — without it,
 * clearcoat bumps would invert on WebGPU.
 *
 * ## Two-tier roughness
 *
 * `lobePreLighting` derives two roughness values from the same source:
 *
 *  - `ccRoughnessIBL` — raw [0..1] value, used for env-map mip selection
 *    and the BRDF LUT lookup. A "perfect mirror" lacquer
 *    (clearcoatRoughness = 0 in the glTF) must hit mip 0 here, otherwise it
 *    looks frosted.
 *  - `ccRoughness`    — `max(ccRoughnessIBL, 0.04)`, used only by the
 *    direct-lighting GGX. A strict zero would blow up the `(a2 - 1)`
 *    denominator in the GGX distribution.
 *
 * ## IBL specular: Karis split-sum, no AO
 *
 * Clearcoat IBL is `prefiltered * (CLEARCOAT_F0 * brdf.x + brdf.y)` —
 * the same split-sum form as the substrate IBL. F90 is implicitly 1.0;
 * unlike the substrate path, the glTF clearcoat spec doesn't define a
 * per-material F90 override (no clearcoat analogue to KHR_materials_specular),
 * so this term doesn't need plumbing.
 *
 * Critically, clearcoat IBL is **not** multiplied by `occlusion`. AO
 * represents shadowing of the substrate by nearby geometry; the lacquer
 * sits on top of the surface and reflects the environment regardless of
 * substrate occlusion. This matches the glTF reference renderer.
 *
 * ## Per-material data
 *
 * Packed into one `vec4<f32>` (`clearcoatParams`) to keep the Material struct
 * small for materials that *do* enable clearcoat:
 *
 * | xyz channel | meaning                                                 |
 * |-------------|---------------------------------------------------------|
 * | `.x`        | clearcoatFactor — strength of the lacquer layer        |
 * | `.y`        | clearcoatRoughness — independent of base roughness     |
 * | `.z`        | clearcoatNormalScale — applied to tangent-space xy      |
 * | `.w`        | reserved                                                |
 *
 * Texture defaults (set by Material3D): `clearcoat` and `clearcoatRoughness`
 * fall back to WHITE (multiplier = 1). The coat-normal-map variant additionally
 * declares a `clearcoatNormal` slot (defaulting to a flat normal map).
 *
 * Spec: https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_clearcoat
 */

/** WGSL: front-facing-corrected geometric normal (see "Double-sided back faces") */
const CC_FACE_NORMAL_GPU = /*wgsl*/ `normalize(select(-input.vNormal, input.vNormal, input.frontFacing))`;
/** GLSL: front-facing-corrected geometric normal */
const CC_FACE_NORMAL_GL = /*glsl*/ `normalize(gl_FrontFacing ? vNormal : -vNormal)`;

const CLEARCOAT_TBN_GPU = /*wgsl*/ `
fn calculateClearcoatTBN(surfaceNormal: vec3<f32>, position: vec3<f32>, texCoord: vec2<f32>) -> mat3x3<f32> {
  let dp1 = dpdx(position);
  let dp2 = -dpdy(position);
  let duv1 = dpdx(texCoord);
  let duv2 = -dpdy(texCoord);

  let dp2perp = cross(dp2, surfaceNormal);
  let dp1perp = cross(surfaceNormal, dp1);
  let tangent = dp2perp * duv1.x + dp1perp * duv2.x;
  let bitangent = dp2perp * duv1.y + dp1perp * duv2.y;

  let invmax = inverseSqrt(max(dot(tangent, tangent), dot(bitangent, bitangent)));
  return mat3x3<f32>(tangent * invmax, bitangent * invmax, surfaceNormal);
}
`;

const CLEARCOAT_TBN_GL = /*glsl*/ `
#ifndef PIXI3D_CLEARCOAT_TBN_DEFINED
#define PIXI3D_CLEARCOAT_TBN_DEFINED
mat3 calculateClearcoatTBN(highp vec3 surfaceNormal, highp vec3 position, highp vec2 texCoord) {
  highp vec3 dp1 = dFdx(position);
  highp vec3 dp2 = dFdy(position);
  highp vec2 duv1 = dFdx(texCoord);
  highp vec2 duv2 = dFdy(texCoord);

  highp vec3 dp2perp = cross(dp2, surfaceNormal);
  highp vec3 dp1perp = cross(surfaceNormal, dp1);
  highp vec3 tangent = dp2perp * duv1.x + dp1perp * duv2.x;
  highp vec3 bitangent = dp2perp * duv1.y + dp1perp * duv2.y;

  highp float invmax = inversesqrt(max(dot(tangent, tangent), dot(bitangent, bitangent)));
  return mat3(tangent * invmax, bitangent * invmax, surfaceNormal);
}
#endif
`;

/**
 * Build a clearcoat bit
 *
 * `withNormalMap` selects the coat-normal-map variant (samples the coat normal
 * texture + builds a TBN) versus the cheaper default (coat frame = geometric
 * normal). See the file header.
 * @param withNormalMap - Whether the coat samples its own normal texture through a TBN
 */
function createClearcoatBit(withNormalMap: boolean): ShaderBit {
  // WGSL coat-normal computation: TBN-perturbed vs. plain geometric normal.
  const gpuNormal = withNormalMap
    ? /*wgsl*/ `
  let ccTangentNormal = sampleClearcoatNormal(input.vUV).rgb * 2.0 - 1.0;
  let ccScaledNormal = vec3<f32>(
    ccTangentNormal.xy * material.clearcoatParams.z,
    ccTangentNormal.z,
  );
  let ccTBN = calculateClearcoatTBN(${CC_FACE_NORMAL_GPU}, input.vPosition, input.vUV);
  let ccNormal = normalize(ccTBN * ccScaledNormal);
`
    : /*wgsl*/ `
  // No coat normal map: the coat frame is the geometric normal.
  let ccNormal = ${CC_FACE_NORMAL_GPU};
`;

  const glNormal = withNormalMap
    ? /*glsl*/ `
  vec3 ccTangentNormal = sampleClearcoatNormal(vUV).rgb * 2.0 - 1.0;
  vec3 ccScaledNormal = vec3(ccTangentNormal.xy * material.clearcoatParams.z, ccTangentNormal.z);
  mat3 ccTBN = calculateClearcoatTBN(${CC_FACE_NORMAL_GL}, vPosition, vUV);
  vec3 ccNormal = normalize(ccTBN * ccScaledNormal);
`
    : /*glsl*/ `
  // No coat normal map: the coat frame is the geometric normal.
  vec3 ccNormal = ${CC_FACE_NORMAL_GL};
`;

  return {
    name: withNormalMap ? 'clearcoat:normalMap' : 'clearcoat',

    textures: withNormalMap
      ? ['clearcoat', 'clearcoatRoughness', 'clearcoatNormal']
      : ['clearcoat', 'clearcoatRoughness'],

    bindings: {
      material: {
        clearcoatParams: 'vec4<f32>',
      },
    },

    gpu: {
      header: withNormalMap
        ? `const CLEARCOAT_F0: f32 = 0.04;\n${CLEARCOAT_TBN_GPU}`
        : `const CLEARCOAT_F0: f32 = 0.04;\n`,

      fragment: {
        lobePreLighting: /*wgsl*/ `
  // KHR_materials_clearcoat — see clearcoatBit.ts for two-tier roughness rationale.
  let ccFactor = material.clearcoatParams.x * sampleClearcoat(input.vUV).r;
  let ccRoughnessRaw = material.clearcoatParams.y * sampleClearcoatRoughness(input.vUV).g;
  let ccRoughnessIBL = clamp(ccRoughnessRaw, 0.0, 1.0);
  let ccRoughness = max(ccRoughnessIBL, 0.04);
${gpuNormal}
  let ccA = ccRoughness * ccRoughness;
  let ccA2 = ccA * ccA;
  let ccA2InvPi = ccA2 * INV_PI;
  let ccK = (ccRoughness + 1.0) * (ccRoughness + 1.0) / 8.0;
  let ccOneMinusK = 1.0 - ccK;
  let ccNDotV = max(dot(ccNormal, viewDir), 0.0);
  let ccVisV = 1.0 / (ccNDotV * ccOneMinusK + ccK);

  var clearcoatLight = vec3<f32>(0.0);
`,
        lobePerLight: /*wgsl*/ `
    // Clearcoat: GGX specular only (no diffuse, dielectric F0 = 0.04).
    {
      let ccHalfVector = normalize(viewDir + lightDir);
      let ccNDotL = max(dot(ccNormal, lightDir), 0.0);
      if (ccNDotL > 0.0) {
        let ccNDotH = max(dot(ccNormal, ccHalfVector), 0.0);
        let ccDDenom = (ccNDotH * ccNDotH * (ccA2 - 1.0) + 1.0);
        // 1e-5 (not 1e-7) keeps the denominator safe when fragment math is
        // promoted to FP16 on mobile — see pbrLightingBit.ts for context.
        let ccD = ccA2InvPi / (ccDDenom * ccDDenom + 1e-5);
        let ccVisL = 1.0 / (ccNDotL * ccOneMinusK + ccK);
        let ccVis = 0.25 * ccVisV * ccVisL;
        let ccHDotV = max(dot(ccHalfVector, viewDir), 0.0);
        // Spherical Gaussian Schlick — see pbrLightingBit.ts for rationale.
        let ccFc5 = exp2((-5.55473 * ccHDotV - 6.98316) * ccHDotV);
        let ccF = CLEARCOAT_F0 + (1.0 - CLEARCOAT_F0) * ccFc5;
        clearcoatLight += ccD * ccF * ccVis * light.color * attenuation * ccNDotL * shadow;
      }
    }
`,
        lobePostLighting: /*wgsl*/ `
  // Clearcoat composite — see clearcoatBit.ts for IBL formulation and AO rationale.
  // Spherical Gaussian Schlick — see pbrLightingBit.ts for rationale.
  let ccFcv5 = exp2((-5.55473 * ccNDotV - 6.98316) * ccNDotV);

  let ccR = reflect(-viewDir, ccNormal);
  // Env radiance via the active env-source bit.
  let ccPrefiltered = sampleEnvironment(ccR, ccRoughnessIBL);
  let ccBrdf = textureSampleLevel(uBrdfLutTexture, uBrdfLutSampler, vec2<f32>(ccNDotV, ccRoughnessIBL), 0.0).rg;
  let clearcoatIBL = ccPrefiltered * (CLEARCOAT_F0 * ccBrdf.x + ccBrdf.y);

  let ccFv = CLEARCOAT_F0 + (1.0 - CLEARCOAT_F0) * ccFcv5;
  let ccAttenuation = 1.0 - ccFactor * ccFv;
  finalColor = finalColor * ccAttenuation + (clearcoatLight + clearcoatIBL) * ccFactor;
`,
      },
    },

    gl: {
      fragment: {
        header: withNormalMap
          ? /*glsl*/ `
#ifndef CLEARCOAT_F0
#define CLEARCOAT_F0 0.04
#endif
${CLEARCOAT_TBN_GL}`
          : /*glsl*/ `
#ifndef CLEARCOAT_F0
#define CLEARCOAT_F0 0.04
#endif
`,
        lobePreLighting: /*glsl*/ `
  // KHR_materials_clearcoat — see clearcoatBit.ts for two-tier roughness rationale.
  float ccFactor = material.clearcoatParams.x * sampleClearcoat(vUV).r;
  float ccRoughnessRaw = material.clearcoatParams.y * sampleClearcoatRoughness(vUV).g;
  float ccRoughnessIBL = clamp(ccRoughnessRaw, 0.0, 1.0);
  float ccRoughness = max(ccRoughnessIBL, 0.04);
${glNormal}
  float ccA = ccRoughness * ccRoughness;
  float ccA2 = ccA * ccA;
  float ccA2InvPi = ccA2 * INV_PI;
  float ccK = (ccRoughness + 1.0) * (ccRoughness + 1.0) / 8.0;
  float ccOneMinusK = 1.0 - ccK;
  float ccNDotV = max(dot(ccNormal, viewDir), 0.0);
  float ccVisV = 1.0 / (ccNDotV * ccOneMinusK + ccK);

  vec3 clearcoatLight = vec3(0.0);
`,
        lobePerLight: /*glsl*/ `
    // Clearcoat: GGX specular only (no diffuse, dielectric F0 = 0.04).
    {
      vec3 ccHalfVector = normalize(viewDir + lightDir);
      float ccNDotL = max(dot(ccNormal, lightDir), 0.0);
      if (ccNDotL > 0.0) {
        float ccNDotH = max(dot(ccNormal, ccHalfVector), 0.0);
        float ccDDenom = (ccNDotH * ccNDotH * (ccA2 - 1.0) + 1.0);
        // 1e-5 (not 1e-7) keeps the denominator safe when fragment math is
        // promoted to FP16 on mobile — see pbrLightingBit.ts for context.
        float ccD = ccA2InvPi / (ccDDenom * ccDDenom + 1e-5);
        float ccVisL = 1.0 / (ccNDotL * ccOneMinusK + ccK);
        float ccVis = 0.25 * ccVisV * ccVisL;
        float ccHDotV = max(dot(ccHalfVector, viewDir), 0.0);
        // Spherical Gaussian Schlick — see pbrLightingBit.ts for rationale.
        float ccFc5 = exp2((-5.55473 * ccHDotV - 6.98316) * ccHDotV);
        float ccF = CLEARCOAT_F0 + (1.0 - CLEARCOAT_F0) * ccFc5;
        clearcoatLight += ccD * ccF * ccVis * light.color * attenuation * ccNDotL * shadow;
      }
    }
`,
        lobePostLighting: /*glsl*/ `
  // Clearcoat composite — see clearcoatBit.ts for IBL formulation and AO rationale.
  // Spherical Gaussian Schlick — see pbrLightingBit.ts for rationale.
  float ccFcv5 = exp2((-5.55473 * ccNDotV - 6.98316) * ccNDotV);

  vec3 ccR = reflect(-viewDir, ccNormal);
  // Env radiance via the active env-source bit.
  vec3 ccPrefiltered = sampleEnvironment(ccR, ccRoughnessIBL);
  vec2 ccBrdf = texture(uBrdfLutTexture, vec2(ccNDotV, ccRoughnessIBL)).rg;
  vec3 clearcoatIBL = ccPrefiltered * (CLEARCOAT_F0 * ccBrdf.x + ccBrdf.y);

  float ccFv = CLEARCOAT_F0 + (1.0 - CLEARCOAT_F0) * ccFcv5;
  float ccAttenuation = 1.0 - ccFactor * ccFv;
  finalColor = finalColor * ccAttenuation + (clearcoatLight + clearcoatIBL) * ccFactor;
`,
      },
    },
  };
}

/**
 * Clearcoat without a coat normal map (coat frame = geometric normal)
 * @internal
 */
export const clearcoatBit: ShaderBit = createClearcoatBit(false);

/**
 * Clearcoat with a coat normal map (samples the coat normal + builds a TBN)
 * @internal
 */
export const clearcoatNormalMapBit: ShaderBit = createClearcoatBit(true);
