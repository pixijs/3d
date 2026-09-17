import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Fills in PBR surface properties from the material storage buffer and batch textures
 *
 * Declares all PBR-specific variables (metallic, roughness, fresnelF0,
 * emissive, etc.) and sets a default `finalColor = albedo` for the unlit
 * fallback.
 *
 * Requires (provided by template):
 *   - `normal: vec3`     — initialized to vertex normal
 *   - `finalColor: vec3` — output colour (this bit sets a default)
 *   - `alpha: float`     — output alpha (this bit overwrites)
 *
 * Provides (consumed by lighting and other bits):
 *   - `albedo, metallic, roughness, fresnelF0, occlusion`
 *   - `specularNormal` — the normal the IBL specular lobe reflects off; defaults
 *     to `normal`, overridden by features (e.g. anisotropy's bent normal)
 *   - `f90` — default 1.0; `specularBit` overrides it when
 *     `KHR_materials_specular` is enabled
 *   - `emissive` — declared as `vec3(0)` default; populated by the optional
 *     `emissiveBit` when the material has non-black emissive
 *   - `viewDir, directLight, ambient`
 *   - `material` — Material struct (GPU: storage buffer entry,
 *     GL: `getMaterial()` accessor)
 *
 * ## Default initializers
 *
 * The `metallic = 0`, `roughness = 1`, `occlusion = 1`, `emissive = 0`
 * defaults exist for two reasons:
 *
 *  1. Downstream bits (transmission, iridescence, emissive) sometimes read
 *     or assign these before `pbrLightingBit` runs.
 *  2. The texture-driven assignments below use `*=`, so a missing PBR
 *     parameter still produces a sane result instead of zero output.
 *
 * `emissive` specifically stays at the default `vec3(0)` when `emissiveBit`
 * isn't in the descriptor (dormant emissive), so `pbrLightingBit`'s
 * `finalColor + emissive` is a no-op and no emissive texture is sampled.
 *
 * Both backends declare these in lock-step — keep them aligned.
 *
 * ## Dielectric F0 from IOR (KHR_materials_ior)
 *
 * `fresnelF0` is derived from the material's IOR (`pbrParams.w`) via the
 * Schlick form `pow((ior - 1) / (ior + 1), 2)`. At the default `ior = 1.5`
 * this evaluates to exactly `0.04`, so any asset without the extension gets
 * the spec's dielectric F0 = 0.04 bit-exactly. Metals still override F0 with
 * `baseColor` via the metallic mix below; the IOR-derived value is the
 * dielectric endpoint.
 *
 * ## Geometric specular antialiasing
 *
 * Kaplanyan & Hofmann 2016, "Stable Geometric Specular Antialiasing", in its
 * simplified screen-derivative form.
 *
 * Adds roughness on pixels where the geometric normal swings rapidly across
 * one screen pixel — typically silhouettes of curved meshes and minified
 * far-away detail — which would otherwise alias as specular sparkles and
 * read as overly sharp transmission distortion at grazing angles.
 *
 * Uses the unperturbed vertex normal: pbrMaterialBit runs BEFORE
 * normalMappingBit, so `normal` here is the interpolated vertex normal,
 * and normal-map noise can't bleed into the roughness term.
 *
 * The `max(roughness, 0.045)` floor keeps the GGX denominator away from zero
 * at alpha = 0, and stops the prefiltered radiance lookup asking for a mip
 * below 0. Where exactly the floor sits depends on the radiance cubemap's
 * base size — a 256px base wants nearer 0.0525 — and anything in
 * [0.04, 0.06] holds both guarantees at the sizes we generate.
 * @internal
 */
export const pbrMaterialBit: ShaderBit = {
  name: 'pbrMaterial',

  // Declaring these features triggers texturesPlugin to generate the
  // sampleBaseColor(uv), sampleMetallicRoughness(uv), etc. helpers used below.
  // `emissive` is owned by emissiveBit — only present when the material has
  // non-black emissive, so dormant-emissive materials skip the texture slot.
  textures: ['baseColor', 'metallicRoughness', 'occlusion', 'normal'],
  bindings: {
    material: {
      baseColor: 'vec4<f32>',
      alphaCutoff: 'f32',
      pbrParams: 'vec4<f32>',
      transmissionVolume: 'vec4<f32>',
      attenuationColorIrid: 'vec4<f32>',
      // glTF `normalTextureInfo.scale`. Owned here — not by the normal-mapping
      // bits — because those are selected per-MESH (geometry tangents + texture)
      // and the Material struct must stay a pure function of the material's
      // construction-pinned bits, so every variant of a material shares one
      // layout. Default 1 is a no-op for meshes without normal mapping.
      normalScale: 'f32',
    },
  },
  gpu: {
    fragment: {
      material: /*wgsl*/ `
  // Defaults — see pbrMaterialBit.ts header. Keep aligned with the GL backend.
  var viewDir: vec3<f32>;
  var metallic: f32 = 0.0;
  var roughness: f32 = 1.0;
  var fresnelF0: vec3<f32>;
  var f90: f32 = 1.0;
  var emissive: vec3<f32> = vec3<f32>(0.0);
  var occlusion: f32 = 1.0;
  var directLight: vec3<f32> = vec3<f32>(0.0);
  var ambient: vec3<f32> = vec3<f32>(0.0);

  var baseColor = material.baseColor;
  metallic = material.pbrParams.x;
  roughness = material.pbrParams.y;
  occlusion = material.pbrParams.z;

  // Dielectric F0 from IOR — see pbrMaterialBit.ts header.
  let ior = material.pbrParams.w;
  let iorRatio = (ior - 1.0) / (ior + 1.0);
  fresnelF0 = vec3<f32>(iorRatio * iorRatio);

  // No HAS_UVS gate: each material's texture array defaults to Texture.WHITE
  // for unbound slots, so sampling at uv=(0,0) returns (1,1,1,1) and the
  // multiplies / decode collapse to a no-op. Keeps WGSL source-level parity
  // with the GLSL backend, which can't use specialization constants to
  // dead-code-eliminate the branch — see pbrMaterialBit.ts header.
  var baseTex = sampleBaseColor(input.vUV);
  // Gamma 2.2 sRGB decode; premultiplied alpha unwrapped first so it acts on
  // the straight colour.
  let baseTexLinear = baseTex.rgb / max(baseTex.a, 0.001);
  baseTex = vec4<f32>(pow(baseTexLinear, vec3<f32>(2.2)), baseTex.a);
  baseColor *= baseTex;

  let mrTex = sampleMetallicRoughness(input.vUV);
  metallic *= mrTex.b;
  roughness *= mrTex.g;

  occlusion *= sampleOcclusion(input.vUV).r;

  // Geometric specular antialiasing — see pbrMaterialBit.ts header.
  let dNdx = abs(dpdx(normal));
  let dNdy = abs(dpdy(normal));
  let dN = max(dNdx, dNdy);
  let geometricRoughness = max(max(dN.x, dN.y), dN.z);
  roughness = clamp(max(roughness, 0.045) + geometricRoughness, 0.0, 1.0);

  albedo *= baseColor.rgb;
  alpha *= baseColor.a;

  viewDir = normalize(camera.uCameraPosition.xyz - input.vPosition);
  fresnelF0 = mix(fresnelF0, albedo, metallic);

  // Specular reflection normal — see pbrMaterialBit.ts header. Default = surface
  // normal; anisotropy overrides it with a bent normal. Eliminated when unused.
  var specularNormal = normal;
`,
    },
  },

  gl: {
    fragment: {
      material: /*glsl*/ `
  // Defaults — see pbrMaterialBit.ts header. Keep aligned with the WGSL backend.
  vec3 viewDir;
  float metallic = 0.0;
  float roughness = 1.0;
  vec3 fresnelF0;
  float f90 = 1.0;
  vec3 emissive = vec3(0.0);
  float occlusion = 1.0;
  vec3 directLight = vec3(0.0);
  vec3 ambient = vec3(0.0);

  vec4 baseColor = material.baseColor;
  metallic = material.pbrParams.x;
  roughness = material.pbrParams.y;
  occlusion = material.pbrParams.z;

  // Dielectric F0 from IOR — see pbrMaterialBit.ts header.
  float ior = material.pbrParams.w;
  float iorRatio = (ior - 1.0) / (ior + 1.0);
  fresnelF0 = vec3(iorRatio * iorRatio);

  vec4 baseTex = sampleBaseColor(vUV);
  // Gamma 2.2 sRGB decode; premultiplied alpha unwrapped first so it acts on
  // the straight colour.
  vec3 baseTexLinear = baseTex.rgb / max(baseTex.a, 0.001);
  baseTex.rgb = pow(baseTexLinear, vec3(2.2));
  baseColor *= baseTex;

  vec4 mrTex = sampleMetallicRoughness(vUV);
  metallic *= mrTex.b;
  roughness *= mrTex.g;

  occlusion *= sampleOcclusion(vUV).r;

  // Geometric specular antialiasing — see pbrMaterialBit.ts header.
  vec3 dNdx = abs(dFdx(normal));
  vec3 dNdy = abs(dFdy(normal));
  vec3 dN = max(dNdx, dNdy);
  float geometricRoughness = max(max(dN.x, dN.y), dN.z);
  roughness = clamp(max(roughness, 0.045) + geometricRoughness, 0.0, 1.0);

  albedo *= baseColor.rgb;
  alpha *= baseColor.a;

  viewDir = normalize(uCameraPosition.xyz - vPosition);
  fresnelF0 = mix(fresnelF0, albedo, metallic);

  // Specular reflection normal — see WGSL counterpart. Default = surface normal;
  // anisotropy overrides it with a bent normal. Eliminated when unused.
  vec3 specularNormal = normal;
`,
    },
  },
};
