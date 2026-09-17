import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * KHR_materials_transmission + KHR_materials_volume shader bit
 *
 * Implements glass / transparent surfaces: samples the opaque colour buffer
 * (`uOpaqueColorTexture`) with IOR-based refraction offset, then applies
 * Beer's Law attenuation for volume absorption.
 *
 * Writes to the `material` slot — runs AFTER `pbrMaterialBit` sets
 * `albedo`/`viewDir`/`normal` but BEFORE `pbrLightingBit` and `iblBit` compute
 * lighting. Glass transmission is light arriving from BEHIND the surface, so it
 * must not be re-lit by front-side illumination: the transmitted scene colour is
 * added to the un-lit `emissive` channel, and the diffuse + ambient lobe is
 * scaled down by `(1 - transmission)` so it isn't double-counted. Specular
 * reflection (including iridescent Fresnel and IBL specular) is untouched, so it
 * still rides on top. This is the glTF model `mix(f_diffuse, f_transmission,
 * transmission) + f_specular` — writing the transmitted colour into `albedo`
 * instead would let the lighting pass diffuse-shade the refracted scene (a
 * milky / washed look, and a clear cube going black under no front lighting).
 *
 * Requires (set by `pbrMaterialBit`):
 *   - `material`, `viewDir`, `normal`, `albedo`
 *   - `input.vUV`, `input.vTextureSlots`
 *
 * Uses globals: `uOpaqueColorTexture` (slot 8), `uBrdfLutSampler` (slot 4).
 *
 * ## World-space model scale (`vModelScale`)
 *
 * `KHR_materials_volume` defines `thicknessFactor` in mesh-local meters,
 * but the refraction ray is added to `vPosition` which is in world units.
 * Without per-axis scale compensation, scaling a glass mesh in the scene
 * tree silently breaks refraction strength. We compute scale from the
 * column lengths of `modelMatrix` (per-axis, so anisotropic scale also
 * works) and forward it via the `vModelScale` inter-stage.
 *
 * ## Per-pixel thickness modulates BOTH refraction AND absorption
 *
 * The thickness texture is sampled up front (in the same uniform-control-flow
 * block as the transmission texture, so derivatives stay valid) and then used
 * for the refraction-ray length, NOT just for Beer's Law absorption.
 *
 * Sampling thickness only inside the absorption branch — and using the
 * global `thicknessFactor` for the refraction ray — means refraction is
 * computed as if the glass were globally at its maximum thickness. On
 * assets that taper at the rims (mosquito wings, glass bottle necks, etc.)
 * this reads as "overpowered": uniform aggressive refraction across the
 * surface instead of subtle distortion at thin areas, strong distortion
 * at thick ones.
 *
 * Beer's-Law absorption uses the world-space path length
 * `length(transmissionRay)` (thickness × per-axis model scale), not the raw
 * `thicknessFactor`: absorption is exponential in distance, so a scaled mesh
 * must attenuate over its scaled path or the glass over-darkens. Matches the
 * glTF spec / three's `volumeAttenuation`. The gate still keys off per-pixel
 * `thickness` so a thinned-out rim skips absorption on its own.
 *
 * ## Albedo tint on transmission
 *
 * The transmitted scene colour is multiplied by `albedo` before it is added to
 * `emissive` — physical glass colours what passes through it. Without this
 * multiply the transmission reads as a raw window onto the scene, ignoring any
 * baseColor the asset author set on the glass. Matches the glTF Sample
 * Renderer's `transmittance = diffuseColor * volumeAttenuation` pattern.
 *
 * ## Fresnel
 *
 * Schlick approximation with `F0 = ((n - 1) / (n + 1))²`, the standard
 * dielectric reflectance at normal incidence. At grazing angles the
 * effective transmission factor falls toward zero (more reflection,
 * less transmission).
 *
 * Note that `fresnelF0` is already set by `pbrMaterialBit` (and possibly
 * modified by `iridescenceBit`) for the SPECULAR pass — we don't touch it
 * here, so iridescent specular reflections still come through correctly.
 *
 * ## Backend parity
 *
 * The GL and WGSL fragments are equivalent. The one idiom difference: GL uses the
 * combined-sampler `textureLod(tex, uv, lod)` where WGSL uses
 * `textureSampleLevel(tex, sampler, uv, lod)`. Both sample the transmission /
 * thickness textures unconditionally — unbound slots resolve to the reserved
 * white slot (returned as 1.0 by the batch-texture getter without sampling), so
 * the multiply is a no-op (no `HAS_UVS` gate; matches pbrMaterialBit).
 * @internal
 */
export const transmissionBit: ShaderBit = {
  name: 'transmission',
  textures: ['transmission', 'thickness'],

  interStage: {
    vModelScale: 'vec3<f32>',
  },

  bindings: {
    material: {
      pbrParams: 'vec4<f32>',
      transmissionVolume: 'vec4<f32>',
      attenuationColorIrid: 'vec4<f32>',
    },
  },

  gpu: {
    vertex: {
      end: /*wgsl*/ `
  output.vModelScale = vec3<f32>(
    length(modelMatrix[0].xyz),
    length(modelMatrix[1].xyz),
    length(modelMatrix[2].xyz)
  );
`,
    },
    fragment: {
      material: /*wgsl*/ `
  // KHR_materials_transmission + KHR_materials_volume — see transmissionBit.ts.
  {
    let transmissionFactor = material.transmissionVolume.x;
    let thicknessFactor = material.transmissionVolume.y;
    let ior = material.pbrParams.w;

    // Unbound transmission / thickness slots resolve to the reserved white slot,
    // which the batch-texture getter returns as 1.0 without sampling — so these
    // multiplies are a no-op when no texture is set (no HAS_UVS gate; matches
    // pbrMaterialBit).
    let txFactor = transmissionFactor * sampleTransmission(input.vUV).r;
    let thickness = thicknessFactor * sampleThickness(input.vUV).g;

    let colorTexDims = vec2<f32>(textureDimensions(uOpaqueColorTexture));

    let refractedDir = refract(-viewDir, normal, 1.0 / ior);
    let transmissionRay = normalize(refractedDir) * thickness * input.vModelScale;
    let exitPoint = input.vPosition + transmissionRay;

    let txRoughness = roughness * clamp(ior * 2.0 - 2.0, 0.0, 1.0);
    let txLod = log2(colorTexDims.x) * txRoughness;

    // sampleScreenCopy hides the power-of-two sub-rect maths (scale + LOD-inset clamp).
    var transmittedColor = sampleScreenCopy(uOpaqueColorTexture, uBrdfLutSampler, exitPoint, txLod).rgb;

    // The opaque buffer is already tone-mapped; approximate inverse so the
    // transmitted colour stays in linear space before PBR re-tonemaps. Gamma
    // 2.0 (x*x) instead of pow(2.2) — see iblBit.ts header for rationale.
    transmittedColor = transmittedColor * transmittedColor;

    let attenuationDistance = material.transmissionVolume.z;
    if (thickness > 0.0 && attenuationDistance < 1e9) {
      let attenuationColor = material.attenuationColorIrid.rgb;
      let attCoeff = -log(max(attenuationColor, vec3(1e-6))) / attenuationDistance;
      transmittedColor *= exp(-attCoeff * length(transmissionRay));
    }

    let txIorRatio = (ior - 1.0) / (ior + 1.0);
    let txF0 = txIorRatio * txIorRatio;
    let txNdotV = max(dot(normal, viewDir), 0.0);
    // Spherical Gaussian Schlick — see pbrLightingBit.ts for rationale.
    let txFc5 = exp2((-5.55473 * txNdotV - 6.98316) * txNdotV);
    let txF = txF0 + (1.0 - txF0) * txFc5;
    let effectiveTx = txFactor * (1.0 - txF);

    // Transmission lobe: the refracted background passes through UN-LIT — add it
    // via emissive so the lighting pass never diffuse-shades it. effectiveTx
    // already folds in txFactor and the (1-F) transmission weight.
    emissive += transmittedColor * albedo * effectiveTx;
    // Drop the diffuse + ambient (incl. IBL-diffuse) lobe for the transmissive
    // fraction so the surviving albedo isn't double-counted; specular survives.
    albedo *= (1.0 - txFactor);
  }
`,
    },
  },

  gl: {
    vertex: {
      end: /*glsl*/ `
  vModelScale = vec3(
    length(modelMatrix[0].xyz),
    length(modelMatrix[1].xyz),
    length(modelMatrix[2].xyz)
  );
`,
    },
    fragment: {
      material: /*glsl*/ `
  // KHR_materials_transmission + KHR_materials_volume — see transmissionBit.ts.
  {
    float transmissionFactor = material.transmissionVolume.x;
    float thicknessFactor = material.transmissionVolume.y;
    float ior = material.pbrParams.w;

    // Unbound transmission / thickness slots default to Texture.WHITE, so the
    // multiplies are no-ops — no HAS_UVS gate (matches pbrMaterialBit on GL).
    // Sampled in uniform control flow so derivatives stay valid.
    float txFactor = transmissionFactor * sampleTransmission(vUV).r;
    float thickness = thicknessFactor * sampleThickness(vUV).g;

    vec2 colorTexDims = vec2(textureSize(uOpaqueColorTexture, 0));

    // Refract through the volume to a world-space exit point, then project it
    // to a screen UV via the camera (screenUVFromWorld). Going through the
    // projection — rather than offsetting gl_FragCoord — keeps the UV correct
    // when the View3D is a smaller inset.
    vec3 refractedDir = refract(-viewDir, normal, 1.0 / ior);
    vec3 transmissionRay = normalize(refractedDir) * thickness * vModelScale;
    vec3 exitPoint = vPosition + transmissionRay;

    // Rougher glass blurs what shows through: pick a mip of the opaque copy
    // proportional to roughness, scaled down at low IOR (less refraction).
    float txRoughness = roughness * clamp(ior * 2.0 - 2.0, 0.0, 1.0);
    float txLod = log2(colorTexDims.x) * txRoughness;

    // sampleScreenCopy hides the power-of-two sub-rect maths (scale + LOD-inset clamp).
    vec3 transmittedColor = sampleScreenCopy(uOpaqueColorTexture, exitPoint, txLod).rgb;

    // The opaque buffer is already tone-mapped; approximate inverse so the
    // transmitted colour stays in linear space before PBR re-tonemaps. Gamma
    // 2.0 (x*x) instead of pow(2.2) — see iblBit.ts header for rationale.
    transmittedColor = transmittedColor * transmittedColor;

    float attenuationDistance = material.transmissionVolume.z;
    if (thickness > 0.0 && attenuationDistance < 1e9) {
      vec3 attenuationColor = material.attenuationColorIrid.rgb;
      vec3 attCoeff = -log(max(attenuationColor, vec3(1e-6))) / attenuationDistance;
      transmittedColor *= exp(-attCoeff * length(transmissionRay));
    }

    float txIorRatio = (ior - 1.0) / (ior + 1.0);
    float txF0 = txIorRatio * txIorRatio;
    float txNdotV = max(dot(normal, viewDir), 0.0);
    // Spherical Gaussian Schlick — see pbrLightingBit.ts for rationale.
    float txFc5 = exp2((-5.55473 * txNdotV - 6.98316) * txNdotV);
    float txF = txF0 + (1.0 - txF0) * txFc5;
    float effectiveTx = txFactor * (1.0 - txF);

    // Transmission lobe: the refracted background passes through UN-LIT — add it
    // via emissive so the lighting pass never diffuse-shades it. effectiveTx
    // already folds in txFactor and the (1-F) transmission weight.
    emissive += transmittedColor * albedo * effectiveTx;
    // Drop the diffuse + ambient (incl. IBL-diffuse) lobe for the transmissive
    // fraction so the surviving albedo isn't double-counted; specular survives.
    albedo *= (1.0 - txFactor);
  }
`,
    },
  },
};
