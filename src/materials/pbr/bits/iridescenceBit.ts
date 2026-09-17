import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * KHR_materials_iridescence — thin-film interference producing angle-dependent rainbow shifts
 *
 * The carnival glass effect.
 *
 * Writes to the `material` slot — runs AFTER pbrMaterialBit sets `fresnelF0`
 * but BEFORE pbrLightingBit uses it for BRDF calculations. This modifies the
 * Fresnel reflectance to include thin-film interference colors.
 *
 * Uses the Belcour & Barla 2017 thin-film model ("A Practical Extension to
 * Microfacet Theory for the Modeling of Varying Iridescence") with
 * Fourier-approximated CIE XYZ sensitivity curves — the formulation adopted
 * by the Khronos glTF Sample Renderer as the reference for this extension.
 *
 * ## Single packed texture slot (R = factor, G = thickness)
 *
 * The glTF spec defines two binding points (`iridescenceTexture` sampled from
 * R, `iridescenceThicknessTexture` sampled from G) but places both channels
 * on distinct texture references specifically so asset authors can alias both
 * refs at the same image. Every Khronos sample asset and every major
 * authoring tool emits one packed RG image. We follow the `sheenBit`
 * precedent and expose ONE slot (`iridescence`): `.r` modulates factor,
 * `.g` drives the thickness lerp between `iridescenceThicknessMinimum` and
 * `iridescenceThicknessMaximum`. Default `Texture.WHITE` decodes to
 * `(1, 1, 1, 1)` so factor-only materials (no texture supplied) are
 * unaffected — the shader always samples.
 *
 * If a pathological asset supplies two *different* textures for the two
 * bindings, `processMaterials.ts` warns and uses the factor texture; the
 * thickness lerp then reads the factor texture's G channel.
 * @internal
 */
export const iridescenceBit: ShaderBit = {
  name: 'iridescence',

  textures: ['iridescence'],

  bindings: {
    material: {
      transmissionVolume: 'vec4<f32>',
      attenuationColorIrid: 'vec4<f32>',
      iridescenceThickness: 'f32',
      iridescenceThicknessMinimum: 'f32',
    },
  },

  gpu: {
    header: /*wgsl*/ `
const IRID_PI: f32 = 3.14159265359;

// CIE XYZ sensitivity curves (Fourier approximation) → Rec.709 RGB.
// From Belcour & Barla 2017; this is the spectral-to-RGB matrix shipped in
// the Khronos glTF Sample Renderer's reference implementation.
const XYZ_TO_REC709 = mat3x3<f32>(
   3.2404542, -0.9692660,  0.0556434,
  -1.5371385,  1.8760108, -0.2040259,
  -0.4985314,  0.0415560,  1.0572252,
);

fn evalSensitivity(OPD: f32, shift: vec3<f32>) -> vec3<f32> {
  let phase = 2.0 * IRID_PI * OPD * 1e-9;
  let val = vec3<f32>(5.4856e-13, 4.4201e-13, 5.2481e-13);
  let pos = vec3<f32>(1.6810e+06, 1.7953e+06, 2.2084e+06);
  let vr  = vec3<f32>(4.3278e+09, 9.3046e+09, 6.6121e+09);
  var xyz = val * sqrt(2.0 * IRID_PI * vr) * cos(pos * phase + shift) * exp(-vr * phase * phase);
  // CIE X has a second Gaussian lobe
  xyz.x += 9.7470e-14 * sqrt(2.0 * IRID_PI * 4.5282e+09) * cos(2.2399e+06 * phase + shift.x) * exp(-4.5282e+09 * phase * phase);
  xyz /= 1.0685e-7;
  let srgb = XYZ_TO_REC709 * xyz;
  return srgb;
}

fn IorToFresnel0(transmittedIor: f32, incidentIor: f32) -> f32 {
  let r = (transmittedIor - incidentIor) / (transmittedIor + incidentIor);
  return r * r;
}

// Per-channel substrate variant: substrate IOR may differ across RGB
// (e.g. metals with chromatic baseF0 like gold or copper). Returning a vec3
// is what lets the metal's tint propagate into the interference colours.
fn IorToFresnel0v(transmittedIor: vec3<f32>, incidentIor: f32) -> vec3<f32> {
  let r = (transmittedIor - vec3(incidentIor)) / (transmittedIor + vec3(incidentIor));
  return r * r;
}

fn Fresnel0ToIorV(f0: vec3<f32>) -> vec3<f32> {
  let sqrtF0 = sqrt(clamp(f0, vec3(0.0), vec3(0.9999)));
  return (vec3(1.0) + sqrtF0) / (vec3(1.0) - sqrtF0);
}

// Spherical Gaussian Schlick — see pbrLightingBit.ts for rationale. The
// literal pow(1-x, 5.0) compiles to an expensive exp+log pair on most mobile
// drivers; SG replaces it with one MAD + one MUL + a hardware exp2.
fn F_Schlick_scalar(f0: f32, f90: f32, VdotH: f32) -> f32 {
  let fc5 = exp2((-5.55473 * VdotH - 6.98316) * VdotH);
  return f0 + (f90 - f0) * fc5;
}

fn F_Schlick_v(f0: vec3<f32>, f90: f32, VdotH: f32) -> vec3<f32> {
  let fc5 = exp2((-5.55473 * VdotH - 6.98316) * VdotH);
  return f0 + (vec3(f90) - f0) * fc5;
}

fn evalIridescence(outsideIor: f32, iridescenceIor: f32, cosTheta: f32,
                    thinFilmThickness: f32, baseF0: vec3<f32>) -> vec3<f32> {
  // Fade iridescence IOR towards outside IOR as film vanishes
  let iridIor = mix(outsideIor, iridescenceIor, smoothstep(0.0, 0.03, thinFilmThickness));

  // Snell's law at the outer/film interface
  let sinTheta2Sq = (outsideIor * outsideIor) / (iridIor * iridIor)
                     * (1.0 - cosTheta * cosTheta);
  let cosTheta2Sq = 1.0 - sinTheta2Sq;
  if (cosTheta2Sq < 0.0) { return vec3<f32>(1.0); }
  let cosTheta2 = sqrt(cosTheta2Sq);

  // --- Fresnel at interface 1 (air → film) ---
  // Both IORs here are scalar so this whole half stays scalar.
  let R12 = IorToFresnel0(iridIor, outsideIor);
  let R12s = F_Schlick_scalar(R12, 1.0, cosTheta);
  let T121 = 1.0 - R12s;
  var phi12: f32 = 0.0;
  if (iridIor < outsideIor) { phi12 = IRID_PI; }
  let phi21 = IRID_PI - phi12;

  // --- Fresnel at interface 2 (film → substrate) ---
  // Substrate IOR is derived per-channel from baseF0 so a chromatic
  // substrate (metals: gold, copper, …) propagates its tint into the
  // interference colours — averaging baseF0 to a scalar collapses that
  // hue and makes iridescence-on-metal look monochrome.
  let baseIor = Fresnel0ToIorV(baseF0);
  let R23 = IorToFresnel0v(baseIor, iridIor);
  let R23s = F_Schlick_v(R23, 1.0, cosTheta2);
  var phi23 = vec3<f32>(0.0);
  if (baseIor.x < iridIor) { phi23.x = IRID_PI; }
  if (baseIor.y < iridIor) { phi23.y = IRID_PI; }
  if (baseIor.z < iridIor) { phi23.z = IRID_PI; }

  // --- Optical path difference & combined phase ---
  let OPD = 2.0 * iridIor * thinFilmThickness * cosTheta2;
  let phi = vec3<f32>(phi21) + phi23;

  // --- Compound reflectance (all per-channel) ---
  let R123 = clamp(R12s * R23s, vec3(1e-5), vec3(0.9999));
  let r123 = sqrt(R123);
  let Rs = (T121 * T121 * R23s) / (vec3(1.0) - R123);

  // DC term — broadband, NOT multiplied by evalSensitivity(0, 0).
  // The Belcour formulation defines C0 as the wavelength-flat reflectance
  // sum (R12 + Rs); the sensitivity curves are only relevant inside the
  // interference series below where they translate the OPD-modulated
  // spectrum into RGB tristimulus. Multiplying C0 by S0 introduces a
  // constant warm tint (matches the column sum of XYZ→Rec709) onto the
  // base reflectance — visible even at thickness=0 where iridescence
  // should vanish entirely.
  var I = vec3<f32>(R12s) + Rs;

  // Interference terms (m=1, m=2) — each bounce attenuated by r123
  var Cm = Rs - vec3<f32>(T121);
  for (var m: i32 = 1; m <= 2; m = m + 1) {
    Cm *= r123;
    let mf = f32(m);
    let Sm = 2.0 * evalSensitivity(mf * OPD, mf * phi);
    I = I + Cm * Sm;
  }

  return max(I, vec3(0.0));
}
`,
    fragment: {
      material: /*wgsl*/ `
  // --- KHR_materials_iridescence ---
  {
    let iridTex = sampleIridescence(input.vUV);
    let iridescenceFactor = material.transmissionVolume.w * iridTex.r;
    let iridescenceIor = material.attenuationColorIrid.w;
    let iridThickness = mix(
      material.iridescenceThicknessMinimum,
      material.iridescenceThickness,
      iridTex.g,
    );
    let iridNdotV = max(dot(normal, viewDir), 0.001);
    let iridF = evalIridescence(1.0, iridescenceIor, iridNdotV, iridThickness, fresnelF0);
    fresnelF0 = mix(fresnelF0, iridF, iridescenceFactor);
  }
`,
    },
  },

  gl: {
    header: /*glsl*/ `
const float IRID_PI = 3.14159265359;

const mat3 XYZ_TO_REC709 = mat3(
   3.2404542, -0.9692660,  0.0556434,
  -1.5371385,  1.8760108, -0.2040259,
  -0.4985314,  0.0415560,  1.0572252
);

vec3 evalSensitivity(float OPD, vec3 shift) {
  float phase = 2.0 * IRID_PI * OPD * 1e-9;
  vec3 val = vec3(5.4856e-13, 4.4201e-13, 5.2481e-13);
  vec3 pos = vec3(1.6810e+06, 1.7953e+06, 2.2084e+06);
  vec3 vr  = vec3(4.3278e+09, 9.3046e+09, 6.6121e+09);
  vec3 xyz = val * sqrt(2.0 * IRID_PI * vr) * cos(pos * phase + shift) * exp(-vr * phase * phase);
  // CIE X has a second Gaussian lobe
  xyz.x += 9.7470e-14 * sqrt(2.0 * IRID_PI * 4.5282e+09) * cos(2.2399e+06 * phase + shift.x) * exp(-4.5282e+09 * phase * phase);
  xyz /= 1.0685e-7;
  vec3 srgb = XYZ_TO_REC709 * xyz;
  return srgb;
}

float IorToFresnel0(float transmittedIor, float incidentIor) {
  float r = (transmittedIor - incidentIor) / (transmittedIor + incidentIor);
  return r * r;
}

vec3 IorToFresnel0v(vec3 transmittedIor, float incidentIor) {
  vec3 r = (transmittedIor - vec3(incidentIor)) / (transmittedIor + vec3(incidentIor));
  return r * r;
}

vec3 Fresnel0ToIorV(vec3 f0) {
  vec3 sqrtF0 = sqrt(clamp(f0, 0.0, 0.9999));
  return (vec3(1.0) + sqrtF0) / (vec3(1.0) - sqrtF0);
}

// Spherical Gaussian Schlick — see pbrLightingBit.ts (and the WGSL counterpart
// above) for rationale.
float F_Schlick_scalar(float f0, float f90, float VdotH) {
  float fc5 = exp2((-5.55473 * VdotH - 6.98316) * VdotH);
  return f0 + (f90 - f0) * fc5;
}

vec3 F_Schlick_v(vec3 f0, float f90, float VdotH) {
  float fc5 = exp2((-5.55473 * VdotH - 6.98316) * VdotH);
  return f0 + (vec3(f90) - f0) * fc5;
}

// See WGSL counterpart for full rationale on per-channel substrate handling
// and on the DC term being broadband (no S0 multiplication).
vec3 evalIridescence(float outsideIor, float iridescenceIor, float cosTheta,
                      float thinFilmThickness, vec3 baseF0) {
  float iridIor = mix(outsideIor, iridescenceIor, smoothstep(0.0, 0.03, thinFilmThickness));

  float sinTheta2Sq = (outsideIor * outsideIor) / (iridIor * iridIor)
                       * (1.0 - cosTheta * cosTheta);
  float cosTheta2Sq = 1.0 - sinTheta2Sq;
  if (cosTheta2Sq < 0.0) { return vec3(1.0); }
  float cosTheta2 = sqrt(cosTheta2Sq);

  float R12 = IorToFresnel0(iridIor, outsideIor);
  float R12s = F_Schlick_scalar(R12, 1.0, cosTheta);
  float T121 = 1.0 - R12s;
  float phi12 = 0.0;
  if (iridIor < outsideIor) { phi12 = IRID_PI; }
  float phi21 = IRID_PI - phi12;

  vec3 baseIor = Fresnel0ToIorV(baseF0);
  vec3 R23 = IorToFresnel0v(baseIor, iridIor);
  vec3 R23s = F_Schlick_v(R23, 1.0, cosTheta2);
  vec3 phi23 = vec3(0.0);
  if (baseIor.x < iridIor) phi23.x = IRID_PI;
  if (baseIor.y < iridIor) phi23.y = IRID_PI;
  if (baseIor.z < iridIor) phi23.z = IRID_PI;

  float OPD = 2.0 * iridIor * thinFilmThickness * cosTheta2;
  vec3 phi = vec3(phi21) + phi23;

  vec3 R123 = clamp(R12s * R23s, 1e-5, 0.9999);
  vec3 r123 = sqrt(R123);
  vec3 Rs = (T121 * T121 * R23s) / (vec3(1.0) - R123);

  vec3 I = vec3(R12s) + Rs;

  vec3 Cm = Rs - vec3(T121);
  for (int m = 1; m <= 2; m++) {
    Cm *= r123;
    float mf = float(m);
    vec3 Sm = 2.0 * evalSensitivity(mf * OPD, mf * phi);
    I += Cm * Sm;
  }

  return max(I, vec3(0.0));
}
`,
    fragment: {
      material: /*glsl*/ `
  // --- KHR_materials_iridescence ---
  {
    vec4 iridTex = sampleIridescence(vUV);
    float iridescenceFactor = material.transmissionVolume.w * iridTex.r;
    float iridescenceIor = material.attenuationColorIrid.w;
    float iridThickness = mix(
      material.iridescenceThicknessMinimum,
      material.iridescenceThickness,
      iridTex.g
    );

    float iridNdotV = max(dot(normal, viewDir), 0.001);
    vec3 iridF = evalIridescence(1.0, iridescenceIor, iridNdotV, iridThickness, fresnelF0);
    fresnelF0 = mix(fresnelF0, iridF, iridescenceFactor);
  }
`,
    },
  },
};
