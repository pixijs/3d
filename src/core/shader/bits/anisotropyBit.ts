import type { ShaderBit } from '../ShaderBit';

/**
 * KHR_materials_anisotropy — stretches the specular response along a surface direction
 *
 * The look of brushed metal, vinyl records, and (with a per-texel direction
 * map) woven carbon fibre. Replaces the base isotropic GGX specular with the
 * anisotropic GGX of Burley / Heitz, for both direct lighting and image-based
 * lighting.
 *
 * ## Two construction-selected variants
 *
 * Built via `createAnisotropyBit`, picked at material-construction time
 * (like `createClearcoatBit`):
 *
 *  - **`anisotropy`** (no texture): the direction is a uniform `(1, 0)` in
 *    tangent space, strength comes from the factor alone. No texture fetch.
 *  - **`anisotropy:texture`**: samples the anisotropy texture — RG is the
 *    per-texel direction (a `[-1,1]` vector encoded to `[0,1]`), B is the
 *    per-texel strength. This is what gives carbon fibre its woven sheen.
 *
 * Both carry the identical `anisotropyParams` struct binding, so the packed
 * Material layout is the same regardless of variant.
 *
 * ## Architecture: a "lobe" that *replaces* the base specular
 *
 * Unlike clearcoat/sheen (which add a lobe on top), anisotropy modifies the
 * substrate's own specular lobe. It splices into `pbrLightingBit`'s single
 * light loop via the lobe convention (see {@link createLightingBit}) and reads
 * the base `specular` local that `pbrLightingBit.perLight` already computed,
 * adding the **delta** `(anisotropicSpecular - specular)`. The net specular is
 * the anisotropic term; diffuse is untouched and `pbrLightingBit` needs no
 * change. There is still **one** light loop and **one** shadow sample.
 *
 *  - `material`         — build the tangent frame and overwrite the shared
 *                         `specularNormal` slot with the bent normal (runs in
 *                         the material slot, before lighting, so `iblBit`
 *                         picks it up).
 *  - `lobePreLighting`  — directional roughnesses + hoisted T·V / B·V.
 *  - `lobePerLight`     — anisotropic GGX D + V, replace the base specular.
 *
 * ## Tangent frame
 *
 * The frame is derived from screen-space UV derivatives (`calculateAnisotropyTBN`),
 * not vertex tangents: it must work on meshes that ship no `TANGENT` attribute
 * (e.g. the Khronos CarbonFibre model). The helper is named distinctly so a
 * material that also normal-maps doesn't redeclare `normalMappingBit`'s
 * `calculateTBN`. The WGSL body negates `dpdy()` for the window-Y convention,
 * exactly as documented on `normalMappingBit`.
 *
 * ## Image-based lighting
 *
 * The specular env reflection is bent toward the low-roughness anisotropy
 * direction — the "bent normal" of the glTF reference renderer. Rather than a
 * bespoke IBL variant, this bit overrides the shared `specularNormal` surface
 * slot (`pbrMaterialBit` defaults it to `normal`); `iblBit` always
 * reflects off `specularNormal`. With no anisotropy bit present, that slot is a
 * dead copy of `normal` the compiler removes, so the IBL shader is unchanged.
 * Diffuse irradiance and the BRDF `N·V` still use `normal`.
 *
 * ## Per-material data
 *
 * Packed into one `vec4<f32>` (`anisotropyParams`):
 *
 * | channel | meaning                                                |
 * |---------|--------------------------------------------------------|
 * | `.x`    | anisotropyStrength — multiplies the texture's B channel |
 * | `.y`    | anisotropyRotation — radians, rotates the direction    |
 * | `.zw`   | reserved                                               |
 *
 * Spec: https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_anisotropy
 *
 * References:
 *   - Anisotropic GGX distribution + height-correlated visibility: the widely
 *     documented optimised form (Heitz 2014, "Understanding the Masking-Shadowing
 *     Function"; Burley 2012, Disney BRDF).
 *   - Bent-normal anisotropic IBL: the glTF Sample Renderer's reference approach.
 *   - Derivative cotangent TBN: tangent-free normal mapping (Schüler) — the same
 *     technique already used by `normalMappingBit`.
 */

const ANISOTROPY_TBN_GPU = /*wgsl*/ `
fn calculateAnisotropyTBN(surfaceNormal: vec3<f32>, position: vec3<f32>, texCoord: vec2<f32>) -> mat3x3<f32> {
  let dp1 = dpdx(position);
  let dp2 = -dpdy(position); // WGSL window-Y is flipped vs GLSL; see normalMappingBit
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

const ANISOTROPY_TBN_GL = /*glsl*/ `
#ifndef PIXI3D_ANISOTROPY_TBN_DEFINED
#define PIXI3D_ANISOTROPY_TBN_DEFINED
mat3 calculateAnisotropyTBN(highp vec3 surfaceNormal, highp vec3 position, highp vec2 texCoord) {
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
 * Build an anisotropy bit
 *
 * The tangent variant emits its own `vAnisoTangent`/`vAnisoBitangent` varyings
 * (distinct from `tangentNormalMappingBit`'s `vTangent`/`vBitangent`) so
 * the two never collide; the shared `aTangent` attribute is deduplicated by the
 * codegen. Both tangent and derivative variants carry the identical
 * `anisotropyParams` binding and texture slot, so swapping between them per-mesh
 * in MaterialSystemGpu keeps the packed Material layout and sample indices stable.
 * @param withTexture - Samples the per-texel direction/strength map instead of the cheaper factor-only default
 * @param withVertexTangent - Builds the tangent frame from the mesh's `TANGENT` attribute (smooth, matches the
 *   glTF reference) instead of the screen-space UV-derivative fallback for meshes that ship no tangents
 */
function createAnisotropyBit(withTexture: boolean, withVertexTangent: boolean): ShaderBit {
  const name = `anisotropy${withTexture ? ':texture' : ''}${withVertexTangent ? ':tangent' : ''}`;

  // Direction (RG, [-1,1]) + strength (B) come from the texture or are constant.
  const gpuSource = withTexture
    ? /*wgsl*/ `
  let anisoSample = sampleAnisotropy(input.vUV);
  let anisoDirRaw = anisoSample.rg * 2.0 - 1.0;
  let anisoTexStrength = anisoSample.b;
`
    : /*wgsl*/ `
  let anisoDirRaw = vec2<f32>(1.0, 0.0);
  let anisoTexStrength = 1.0;
`;

  const glSource = withTexture
    ? /*glsl*/ `
  vec4 anisoSample = sampleAnisotropy(vUV);
  vec2 anisoDirRaw = anisoSample.rg * 2.0 - 1.0;
  float anisoTexStrength = anisoSample.b;
`
    : /*glsl*/ `
  vec2 anisoDirRaw = vec2(1.0, 0.0);
  float anisoTexStrength = 1.0;
`;

  // Tangent frame: vertex tangents (smooth) when present, else a UV-derivative
  // TBN (faceted, but works on tangent-less meshes).
  // The anisotropy frame uses the *geometric* normal, not the normal-mapped one:
  // re-deriving the tangent against a bumpy normal makes the direction wobble
  // per-texel (e.g. concentric rings on a grooved surface). Shading still uses
  // the perturbed `normal` (nDotH/nDotL and the bent specularNormal); only the
  // direction frame is geometric. Matches the glTF reference (anisotropicB = cross(ng, T)).
  const gpuFrame = withVertexTangent
    ? /*wgsl*/ `
  let anisoTw = normalize(input.vAnisoTangent);
  let anisoBw = normalize(input.vAnisoBitangent);
  let anisoT = normalize(anisoDir.x * anisoTw + anisoDir.y * anisoBw);
`
    : /*wgsl*/ `
  let anisoTBN = calculateAnisotropyTBN(anisoGeoN, input.vPosition, input.vUV);
  let anisoT = normalize(anisoTBN * vec3<f32>(anisoDir, 0.0));
`;

  const glFrame = withVertexTangent
    ? /*glsl*/ `
  vec3 anisoTw = normalize(vAnisoTangent);
  vec3 anisoBw = normalize(vAnisoBitangent);
  vec3 anisoT = normalize(anisoDir.x * anisoTw + anisoDir.y * anisoBw);
`
    : /*glsl*/ `
  mat3 anisoTBN = calculateAnisotropyTBN(anisoGeoN, vPosition, vUV);
  vec3 anisoT = normalize(anisoTBN * vec3(anisoDir, 0.0));
`;

  const bit: ShaderBit = {
    name,

    textures: withTexture ? ['anisotropy'] : [],

    bindings: {
      material: {
        anisotropyParams: 'vec4<f32>',
      },
    },

    gpu: {
      // The UV-derivative TBN helper is only needed by the derivative variant.
      header: withVertexTangent ? undefined : ANISOTROPY_TBN_GPU,
      fragment: {
        // Runs in the material slot (after the normal is finalised) so the
        // overwritten `specularNormal` is available to iblBit's lighting slot.
        material: /*wgsl*/ `
  // KHR_materials_anisotropy — see anisotropyBit.ts.
${gpuSource}
  let anisoRot = material.anisotropyParams.y;
  let anisoC = cos(anisoRot);
  let anisoS = sin(anisoRot);
  let anisoDir = vec2<f32>(
    anisoDirRaw.x * anisoC - anisoDirRaw.y * anisoS,
    anisoDirRaw.x * anisoS + anisoDirRaw.y * anisoC,
  );
  let anisoStrength = clamp(material.anisotropyParams.x * anisoTexStrength, 0.0, 1.0);

  // Geometric normal (front-face corrected), kept smooth across normal-map bumps.
  let anisoGeoN = normalize(select(-input.vNormal, input.vNormal, input.frontFacing));
${gpuFrame}
  let anisoB = normalize(cross(anisoGeoN, anisoT));

  // Bend the specular IBL reflection toward the anisotropy grain (glTF reference
  // renderer): overwrite the shared specularNormal slot (default = normal). Falls
  // back to the geometric normal where the cross collapses (anisotropy bitangent
  // ~parallel to the view) to avoid normalize(0) = NaN.
  let anisoBentCross = cross(cross(anisoB, viewDir), anisoB);
  let anisoBentLenSq = dot(anisoBentCross, anisoBentCross);
  var anisoBentN = normal;
  if (anisoBentLenSq > 1e-8) {
    anisoBentN = anisoBentCross * inverseSqrt(anisoBentLenSq);
  }
  let anisoBend = 1.0 - anisoStrength * (1.0 - roughness);
  let anisoBend4 = anisoBend * anisoBend * anisoBend * anisoBend;
  specularNormal = normalize(mix(anisoBentN, normal, anisoBend4));
`,
        lobePreLighting: /*wgsl*/ `
  // Directional roughnesses; a (= roughness^2) comes from pbrLightingBit.
  let anisoAlphaB = a;
  let anisoAlphaT = mix(a, 1.0, anisoStrength * anisoStrength);
  let anisoTdotV = dot(anisoT, viewDir);
  let anisoBdotV = dot(anisoB, viewDir);
`,
        lobePerLight: /*wgsl*/ `
    // Anisotropic GGX (Burley D, Heitz height-correlated V); replaces the base
    // isotropic specular by adding the delta over pbrLightingBit's specular.
    {
      let anisoTdotL = dot(anisoT, lightDir);
      let anisoBdotL = dot(anisoB, lightDir);
      let anisoTdotH = dot(anisoT, halfVector);
      let anisoBdotH = dot(anisoB, halfVector);

      let anisoA2 = anisoAlphaT * anisoAlphaB;
      let anisoFv = vec3<f32>(anisoAlphaB * anisoTdotH, anisoAlphaT * anisoBdotH, anisoA2 * nDotH);
      let anisoW2 = anisoA2 / max(dot(anisoFv, anisoFv), 1e-5);
      let anisoD = anisoA2 * anisoW2 * anisoW2 * INV_PI;

      let anisoGGXV = nDotL * length(vec3<f32>(anisoAlphaT * anisoTdotV, anisoAlphaB * anisoBdotV, nDotV));
      let anisoGGXL = nDotV * length(vec3<f32>(anisoAlphaT * anisoTdotL, anisoAlphaB * anisoBdotL, nDotL));
      let anisoVis = 0.5 / max(anisoGGXV + anisoGGXL, 1e-5);

      let anisoSpec = anisoD * fresnel * anisoVis;
      directLight += (anisoSpec - specular) * radiance * nDotL * shadow;
    }
`,
      },
    },

    gl: {
      fragment: {
        // The UV-derivative TBN helper is only needed by the derivative variant.
        header: withVertexTangent ? undefined : ANISOTROPY_TBN_GL,
        material: /*glsl*/ `
  // KHR_materials_anisotropy — see anisotropyBit.ts.
${glSource}
  float anisoRot = material.anisotropyParams.y;
  float anisoC = cos(anisoRot);
  float anisoS = sin(anisoRot);
  vec2 anisoDir = vec2(
    anisoDirRaw.x * anisoC - anisoDirRaw.y * anisoS,
    anisoDirRaw.x * anisoS + anisoDirRaw.y * anisoC
  );
  float anisoStrength = clamp(material.anisotropyParams.x * anisoTexStrength, 0.0, 1.0);

  // Geometric normal (front-face corrected), kept smooth across normal-map bumps.
  vec3 anisoGeoN = normalize(gl_FrontFacing ? vNormal : -vNormal);
${glFrame}
  vec3 anisoB = normalize(cross(anisoGeoN, anisoT));

  // Bend the specular IBL reflection toward the anisotropy grain — overwrite the
  // shared specularNormal slot (default = normal). Falls back to the geometric
  // normal where the cross collapses, to avoid normalize(0) = NaN.
  vec3 anisoBentCross = cross(cross(anisoB, viewDir), anisoB);
  float anisoBentLenSq = dot(anisoBentCross, anisoBentCross);
  vec3 anisoBentN = anisoBentLenSq > 1e-8 ? anisoBentCross * inversesqrt(anisoBentLenSq) : normal;
  float anisoBend = 1.0 - anisoStrength * (1.0 - roughness);
  float anisoBend4 = anisoBend * anisoBend * anisoBend * anisoBend;
  specularNormal = normalize(mix(anisoBentN, normal, anisoBend4));
`,
        lobePreLighting: /*glsl*/ `
  // Directional roughnesses; a (= roughness^2) comes from pbrLightingBit.
  float anisoAlphaB = a;
  float anisoAlphaT = mix(a, 1.0, anisoStrength * anisoStrength);
  float anisoTdotV = dot(anisoT, viewDir);
  float anisoBdotV = dot(anisoB, viewDir);
`,
        lobePerLight: /*glsl*/ `
    // Anisotropic GGX (Burley D, Heitz height-correlated V); replaces the base
    // isotropic specular by adding the delta over pbrLightingBit's specular.
    {
      float anisoTdotL = dot(anisoT, lightDir);
      float anisoBdotL = dot(anisoB, lightDir);
      float anisoTdotH = dot(anisoT, halfVector);
      float anisoBdotH = dot(anisoB, halfVector);

      float anisoA2 = anisoAlphaT * anisoAlphaB;
      vec3 anisoFv = vec3(anisoAlphaB * anisoTdotH, anisoAlphaT * anisoBdotH, anisoA2 * nDotH);
      float anisoW2 = anisoA2 / max(dot(anisoFv, anisoFv), 1e-5);
      float anisoD = anisoA2 * anisoW2 * anisoW2 * INV_PI;

      float anisoGGXV = nDotL * length(vec3(anisoAlphaT * anisoTdotV, anisoAlphaB * anisoBdotV, nDotV));
      float anisoGGXL = nDotV * length(vec3(anisoAlphaT * anisoTdotL, anisoAlphaB * anisoBdotL, nDotL));
      float anisoVis = 0.5 / max(anisoGGXV + anisoGGXL, 1e-5);

      vec3 anisoSpec = anisoD * fresnel * anisoVis;
      directLight += (anisoSpec - specular) * radiance * nDotL * shadow;
    }
`,
      },
    },
  };

  // The vertex-tangent variant reads the mesh tangent and emits a smooth
  // world-space frame; the derivative variant adds nothing to the vertex stage.
  if (withVertexTangent) {
    bit.attributes = { aTangent: 'float32x4' };
    bit.interStage = { vAnisoTangent: 'vec3<f32>', vAnisoBitangent: 'vec3<f32>' };
    bit.gpu!.vertex = {
      input: /*wgsl*/ `  tangent = input.aTangent.xyz;`,
      end: /*wgsl*/ `
  // World-space tangent frame for anisotropy. Skinning has already transformed the
  // shared \`tangent\` local in stage 1, so the grain follows the skeleton. Handedness
  // comes from the raw attribute, never the skin-transformed local, so the ±1 sign
  // can't be perturbed by the bone matrix (and matches the GL path exactly).
  let anisoWorldT = normalize(modelMatrix3 * tangent);
  output.vAnisoTangent = anisoWorldT;
  output.vAnisoBitangent = cross(worldNormal, anisoWorldT) * input.aTangent.w;
`,
    };
    bit.gl!.vertex = {
      // Seed the shared \`tangent\` local so skinningBitGl transforms it in stage 1,
      // exactly like the WGSL input slot — otherwise the grain freezes in bind pose
      // on skinned meshes.
      input: /*glsl*/ `  tangent = aTangent.xyz;`,
      end: /*glsl*/ `
  // World-space tangent frame for anisotropy (skinning already applied to tangent).
  vec3 anisoWorldT = normalize(modelMatrix3 * tangent);
  vAnisoTangent = anisoWorldT;
  vAnisoBitangent = cross(worldNormal, anisoWorldT) * aTangent.w;
`,
    };
  }

  return bit;
}

/**
 * Anisotropy, UV-derivative tangent frame (no `TANGENT` attribute)
 * @internal
 */
export const anisotropyBit: ShaderBit = createAnisotropyBit(false, false);

/**
 * Anisotropy with a per-texel direction/strength texture, UV-derivative frame
 * @internal
 */
export const anisotropyTextureBit: ShaderBit = createAnisotropyBit(true, false);

/**
 * Anisotropy using the mesh's vertex `TANGENT` for a smooth frame
 * @internal
 */
export const anisotropyTangentBit: ShaderBit = createAnisotropyBit(false, true);

/**
 * Anisotropy with a direction texture, using the mesh's vertex `TANGENT`
 * @internal
 */
export const anisotropyTextureTangentBit: ShaderBit = createAnisotropyBit(true, true);

/**
 * Map a UV-derivative anisotropy bit to its vertex-tangent variant
 *
 * Used by MaterialSystemGpu to pick the smooth frame per-mesh when a `TANGENT`
 * attribute is present (mirroring the normalMapping/tangentNormalMapping
 * selection). Any non-anisotropy bit is returned unchanged, so it is safe to
 * call on every descriptor bit.
 * @param bit - The descriptor bit to map
 * @returns The vertex-tangent variant for anisotropy bits; `bit` unchanged otherwise
 * @internal
 */
export function anisotropyTangentVariant(bit: ShaderBit): ShaderBit {
  if (bit === anisotropyBit) return anisotropyTangentBit;
  if (bit === anisotropyTextureBit) return anisotropyTextureTangentBit;
  return bit;
}
