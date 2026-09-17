import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Reads Blinn-Phong surface properties and sets up the Phong lighting contract variables
 *
 * Reads from the material storage buffer, samples the base-colour texture, and
 * sRGB-decodes it to linear light — Phong shades in linear space and tone-maps
 * downstream, so the albedo texture must be decoded (unlike the unlit
 * `flatMaterialBit`, which shows the texture as authored).
 *
 * Provides (consumed by phongLightingBit + the optional map bits):
 *   - albedo           vec3 — base colour (linear)
 *   - viewDir          vec3 — normalized fragment → camera
 *   - specularColor    vec3 — specular tint
 *   - shininess        f32  — specular exponent (>= 1)
 *   - emissive         vec3 — default vec3(0); assigned by the reused `emissiveBit`
 *   - specularStrength f32  — the material's scalar dial (default 1);
 *     `phongSpecularTextureBit` multiplies its texture on top
 *
 * `emissive` is declared as a neutral default so the downstream read stays a
 * no-op when the optional emissive bit isn't in the descriptor — the same
 * pattern `pbrMaterialBit` uses.
 * @internal
 */
export const phongMaterialBit: ShaderBit = {
  name: 'phongMaterial',

  // The `normal` slot is always reserved (defaults to the flat NORMAL_MAP).
  // The pipe gates the actual sampling + TBN on `textures.normal !== NORMAL_MAP`,
  // so an unmapped material does no normal work either way — reserving the slot
  // costs nothing per fragment and keeps mapped and unmapped materials in the
  // same texture-count batch bucket.
  textures: ['baseColor', 'normal'],

  bindings: {
    material: {
      baseColor: 'vec4<f32>',
      specularColor: 'vec3<f32>',
      shininess: 'f32',
      // Whole-lobe specular scale, Fresnel rim included — 0 kills the highlight.
      specularStrength: 'f32',
      alphaCutoff: 'f32',
      // glTF `normalTextureInfo.scale`. Owned here — not by the normal-mapping
      // bits — because those are selected per-MESH (geometry tangents +
      // texture) and the Material struct must stay a pure function of the
      // material's construction-pinned bits. Default 1 is a no-op.
      normalScale: 'f32',
    },
  },

  gpu: {
    fragment: {
      material: /*wgsl*/ `
  // Neutral default — overwritten by the optional emissive bit.
  var emissive: vec3<f32> = vec3<f32>(0.0);
  // Scalar dial; the optional specular texture bit multiplies on top.
  var specularStrength = material.specularStrength;

  var baseColor = material.baseColor;

  // No HAS_UVS gate: unbound base-colour slots default to Texture.WHITE, so
  // sampling at uv=(0,0) returns (1,1,1,1) and the multiply collapses to a
  // no-op. sRGB → linear (gamma 2.2) decode; premultiplied alpha unwrapped
  // first so the decode acts on the straight colour. Matches pbrMaterialBit.
  var baseTex = sampleBaseColor(input.vUV);
  let baseTexLinear = baseTex.rgb / max(baseTex.a, 0.001);
  baseTex = vec4<f32>(pow(baseTexLinear, vec3<f32>(2.2)), baseTex.a);
  baseColor *= baseTex;

  albedo *= baseColor.rgb;
  alpha *= baseColor.a;

  let viewDir = normalize(camera.uCameraPosition.xyz - input.vPosition);
  let specularColor = material.specularColor;
  let shininess = max(material.shininess, 1.0);
`,
    },
  },

  gl: {
    fragment: {
      material: /*glsl*/ `
  vec3 emissive = vec3(0.0);
  float specularStrength = material.specularStrength;

  vec4 baseColor = material.baseColor;

  vec4 baseTex = sampleBaseColor(vUV);
  vec3 baseTexLinear = baseTex.rgb / max(baseTex.a, 0.001);
  baseTex.rgb = pow(baseTexLinear, vec3(2.2));
  baseColor *= baseTex;

  albedo *= baseColor.rgb;
  alpha *= baseColor.a;

  vec3 viewDir = normalize(uCameraPosition.xyz - vPosition);
  vec3 specularColor = material.specularColor;
  float shininess = max(material.shininess, 1.0);
`,
    },
  },
};
