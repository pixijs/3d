import type { ShaderBit } from '../../../core/shader/ShaderBit';
import { screenSpaceFuncsBit } from './screenSpaceFuncsBit';

/**
 * Adds what shows through to the unlit `emissive`, so front lights don't shade it, and takes that share
 * out of `albedo`. WebGPU samples the opaque copy with `uBrdfLutSampler`, whose linear mip filter the blur needs
 * @internal
 */
export const transmissionBit: ShaderBit = {
  name: 'transmission',
  requires: [screenSpaceFuncsBit],
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

    transmittedColor = decodeToLinear(transmittedColor);

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
    let txF = f90 * (txF0 + (1.0 - txF0) * txFc5);
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

    transmittedColor = decodeToLinear(transmittedColor);

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
    float txF = f90 * (txF0 + (1.0 - txF0) * txFc5);
    float effectiveTx = txFactor * (1.0 - txF);

    emissive += transmittedColor * albedo * effectiveTx;
    albedo *= (1.0 - txFactor);
  }
`,
    },
  },
};
