import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * `KHR_materials_transmission` and `KHR_materials_volume`: glass and other surfaces you see through
 *
 * Samples the copy of the opaque pass's colour (`uOpaqueColorTexture`) where the refracted view
 * ray leaves the volume, then darkens it by Beer's law for absorption.
 *
 * It runs in the `material` slot after `pbrMaterialBit` and before the lighting bits. Light passing
 * through comes from behind the surface, so front lighting must not shade it again: the
 * transmitted colour goes into the unlit `emissive`, and `albedo` is scaled by `1 - transmission`
 * so the diffuse and ambient terms, environment diffuse included, don't count that fraction
 * twice. Specular reflection, iridescent or not, is untouched and sits on top. That is the glTF
 * model, `mix(diffuse, transmission, factor) + specular`. Writing the transmitted colour into
 * `albedo` instead would light the scene behind as if it were paint: milky, and black with no
 * front light.
 *
 * - Thickness is in the mesh's own units, but the refraction ray is added to the world-space
 *   position. The vertex stage passes the model matrix's column lengths as `vModelScale`, so a
 *   mesh scaled along any axis refracts and absorbs at its scaled size.
 * - The thickness map scales the refraction ray as well as the absorption path, so glass that
 *   tapers at its rims refracts less there.
 * - Absorption is exponential in distance, so it follows the world-space path length,
 *   `length(transmissionRay)`. It is skipped where thickness is 0 and when `attenuationDistance` is
 *   1e9 or more.
 * - Rougher glass blurs what shows through: the bit samples a mip of the opaque copy in proportion
 *   to roughness, scaled toward zero as the IOR drops to 1.
 * - The transmitted colour is multiplied by `albedo`, so tinted glass tints what passes through.
 * - Transmission is weighted by `1 - F`, Schlick Fresnel with `F0 = ((ior - 1) / (ior + 1))²`, so
 *   it fades toward grazing angles. `fresnelF0` stays as the bits before it left it, for the
 *   specular.
 * - The opaque copy holds display-encoded colour: the view's tone curve, then its 1/2.2 encode.
 *   Squaring it is a cheap approximate decode back to linear; the tone curve isn't undone.
 * - `sampleScreenCopy` projects the exit point through the camera rather than offsetting the
 *   fragment's screen position, which keeps it right when the view covers part of its target.
 * - Both textures are sampled before the branch, where derivatives are valid. An unset slot holds
 *   `Texture.WHITE`, so its multiply changes nothing.
 *
 * WebGPU samples the opaque copy with `uBrdfLutSampler`; WebGL's `sampler2D` carries its own.
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
  {
    let transmissionFactor = material.transmissionVolume.x;
    let thicknessFactor = material.transmissionVolume.y;
    let ior = material.pbrParams.w;

    let txFactor = transmissionFactor * sampleTransmission(input.vUV).r;
    let thickness = thicknessFactor * sampleThickness(input.vUV).g;

    let colorTexDims = vec2<f32>(textureDimensions(uOpaqueColorTexture));

    let refractedDir = refract(-viewDir, normal, 1.0 / ior);
    let transmissionRay = normalize(refractedDir) * thickness * input.vModelScale;
    let exitPoint = input.vPosition + transmissionRay;

    let txRoughness = roughness * clamp(ior * 2.0 - 2.0, 0.0, 1.0);
    let txLod = log2(colorTexDims.x) * txRoughness;

    var transmittedColor = sampleScreenCopy(uOpaqueColorTexture, uBrdfLutSampler, exitPoint, txLod).rgb;

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
    let txFc5 = exp2((-5.55473 * txNdotV - 6.98316) * txNdotV);
    let txF = txF0 + (1.0 - txF0) * txFc5;
    let effectiveTx = txFactor * (1.0 - txF);

    emissive += transmittedColor * albedo * effectiveTx;
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
  {
    float transmissionFactor = material.transmissionVolume.x;
    float thicknessFactor = material.transmissionVolume.y;
    float ior = material.pbrParams.w;

    float txFactor = transmissionFactor * sampleTransmission(vUV).r;
    float thickness = thicknessFactor * sampleThickness(vUV).g;

    vec2 colorTexDims = vec2(textureSize(uOpaqueColorTexture, 0));

    vec3 refractedDir = refract(-viewDir, normal, 1.0 / ior);
    vec3 transmissionRay = normalize(refractedDir) * thickness * vModelScale;
    vec3 exitPoint = vPosition + transmissionRay;

    float txRoughness = roughness * clamp(ior * 2.0 - 2.0, 0.0, 1.0);
    float txLod = log2(colorTexDims.x) * txRoughness;

    vec3 transmittedColor = sampleScreenCopy(uOpaqueColorTexture, exitPoint, txLod).rgb;

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
    float txFc5 = exp2((-5.55473 * txNdotV - 6.98316) * txNdotV);
    float txF = txF0 + (1.0 - txF0) * txFc5;
    float effectiveTx = txFactor * (1.0 - txF);

    emissive += transmittedColor * albedo * effectiveTx;
    albedo *= (1.0 - txFactor);
  }
`,
    },
  },
};
