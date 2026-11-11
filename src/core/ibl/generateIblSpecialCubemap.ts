import { BindGroup, CubeTexture, RenderTarget, State, TextureSource, UniformGroup } from 'pixi.js';
import type { CubeTextureSource, WebGLRenderer, WebGPURenderer } from 'pixi.js';

import { fullscreenTriangleGeometry } from '../fullscreenTriangleGeometry';
import { decodeToLinearBit, isLinearFormat } from '../shader/bits/decodeToLinearBit';
import { iblSamplingFuncsBit } from '../shader/bits/iblSamplingFuncsBit';
import type { ShaderBit } from '../shader/ShaderBit';
import type { ShaderBitTemplate } from '../shader/ShaderBitTemplate';
import { assertFloatRenderable, floatRgbFormat } from '../textures/floatRenderTargets';

interface GenerateIblSpecialCubemapOptions {
  renderer: WebGPURenderer | WebGLRenderer;
  sourceTexture: CubeTexture;
  size?: number;
  sampleCount?: number;
  mipLevelCount?: number;
  label?: string;
}

/**
 * Largest value every `rg11b10ufloat` channel holds; this prefilter and `equirectToCube.ts` cap radiance at it,
 * so no texel becomes infinity
 * @internal
 */
export const RG11B10_MAX = 64512;

/** The source's mip count once uploaded, since pixi raises it for `autoGenerateMipmaps` only at upload */
function sourceMipLevelCount(source: CubeTextureSource): number {
  return source.autoGenerateMipmaps
    ? Math.floor(Math.log2(Math.max(source.pixelWidth, source.pixelHeight))) + 1
    : source.mipLevelCount;
}

/**
 * Prefilters an environment cube into the specular cube IBL reads, restoring the bind as `generateBrdfLut` does
 *
 * Writes `floatRgbFormat`, since every lit fragment samples the cube and 4 bytes a texel halve `rgba16float`'s
 * bandwidth. Floors the weight sum at 1e-4, as a 0 / 0 NaN would stay in the mip. Only the WGSL face mapping
 * negates y, as WebGPU puts texture row 0 at clip y = +1.
 * @throws On WebGL 2 without `EXT_color_buffer_float`.
 * @internal
 */
export function generateIblSpecialCubemap(options: GenerateIblSpecialCubemapOptions): CubeTexture {
  const { renderer, sourceTexture } = options;

  const size = options.size ?? Math.min(256, Math.max(128, sourceTexture.source.pixelWidth));
  const sampleCount = options.sampleCount ?? 1024;
  const label = options.label ?? 'ibl-specular';
  assertFloatRenderable(renderer, 'View3D environment, for the cube a cubemap environment is prefiltered into');
  const format = floatRgbFormat(renderer);
  const mipLevelCount = options.mipLevelCount ?? 5;

  const gpuTemplate = /* wgsl */ `
     {{header}}

     fn getDirection(face: i32, pos: vec2<f32>) -> vec3<f32> {
        let u = pos.x;
        let v = -pos.y;
        
        var dir = vec3<f32>(0.0);
        
        switch face {
            case 0: { dir = vec3<f32>(1.0, -v, -u); }
            case 1: { dir = vec3<f32>(-1.0, -v, u); }
            case 2: { dir = vec3<f32>(u, 1.0, v); }
            case 3: { dir = vec3<f32>(u, -1.0, -v); }
            case 4: { dir = vec3<f32>(u, -v, 1.0); }
            default: { dir = vec3<f32>(-u, -v, -1.0); }
        }

        return dir;
     }

     fn sourceLod(NdotH: f32, roughness: f32, solidAnglePerTexel: f32) -> f32 {
        let a2 = roughness * roughness * roughness * roughness;
        let d = NdotH * NdotH * (a2 - 1.0) + 1.0;
        let pdf = a2 / (PI * d * d) * 0.25;
        let solidAnglePerSample = 1.0 / (local.sampleCount * pdf + 1e-4);
        return clamp(0.5 * log2(solidAnglePerSample / solidAnglePerTexel) + 1.0, 0.0, local.sourceMaxMip);
     }

     @vertex
     fn mainVertex(input: VertexInput) -> VertexOutput {
       var output: VertexOutput;
       output.position = vec4<f32>(input.aPosition, 0.0, 1.0);
       output.vDir = getDirection(i32(local.layer + 0.5), input.aPosition);
       return output;
     }

     @fragment
     fn mainFragment(input: FragmentInput) -> @location(0) vec4<f32> {
        let N = normalize(input.vDir);
        let R = N;
        let V = R;
        
        let maxMipLevel = f32(local.mipLevelCount) - 1.0;
        let roughness = local.mipLevel / maxMipLevel;
        
        if roughness < 0.01 {
            let s = textureSampleLevel(uSourceTexture, uSampler, N, 0.0).rgb;
            return vec4<f32>(min(decodeToLinear(s), vec3<f32>(${RG11B10_MAX}.0)), 1.0);
        }
        
        var prefilteredColor = vec3<f32>(0.0);
        var totalWeight = 0.0;
        
        let sampleCount = u32(local.sampleCount);
        let solidAnglePerTexel = 4.0 * PI / (6.0 * local.sourceSize * local.sourceSize);
        
        for (var i = 0u; i < sampleCount; i++) {
            let Xi = hammersley(i, sampleCount);
            let H = importanceSampleGGX(Xi, N, roughness);
            let L = normalize(2.0 * dot(V, H) * H - V);
            
            let NdotL = max(dot(N, L), 0.0);
            let lod = sourceLod(dot(N, H), roughness, solidAnglePerTexel);
            let sampleColor = decodeToLinear(textureSampleLevel(uSourceTexture, uSampler, L, lod).rgb);
            
            let weight = NdotL * step(0.0001, NdotL);
            prefilteredColor += sampleColor * weight;
            totalWeight += weight;
        }
        
        prefilteredColor = prefilteredColor / max(totalWeight, 1e-4);
        
        return vec4<f32>(min(prefilteredColor, vec3<f32>(${RG11B10_MAX}.0)), 1.0);
     }
  `;

  const glTemplate = {
    vertex: /* glsl */ `#version 300 es
        {{header}}

        vec3 getDirection(int face, vec2 pos) {
            float u = pos.x;
            float v = pos.y;
            
            vec3 dir = vec3(0.0);
            
            switch(face) {
                case 0: dir = vec3(1.0, -v, -u); break;
                case 1: dir = vec3(-1.0, -v, u); break;
                case 2: dir = vec3(u, 1.0, v); break;
                case 3: dir = vec3(u, -1.0, -v); break;
                case 4: dir = vec3(u, -v, 1.0); break;
                default: dir = vec3(-u, -v, -1.0); break;
            }

            return dir;
        }

        void main() {
            gl_Position = vec4(aPosition, 0.0, 1.0);
            vDir = getDirection(int(layer + 0.5), aPosition);
        }
      `,
    fragment: /* glsl */ `#version 300 es
        {{header}}

        out vec4 fragColor;

        float sourceLod(float NdotH, float roughness, float solidAnglePerTexel) {
            float a2 = roughness * roughness * roughness * roughness;
            float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
            float pdf = a2 / (PI * d * d) * 0.25;
            float solidAnglePerSample = 1.0 / (sampleCount * pdf + 1e-4);
            return clamp(0.5 * log2(solidAnglePerSample / solidAnglePerTexel) + 1.0, 0.0, sourceMaxMip);
        }

        void main() {
            vec3 N = normalize(vDir);
            vec3 R = N;
            vec3 V = R;
            
            float maxMipLevel = mipLevelCount - 1.0;
            float roughness = mipLevel / maxMipLevel;
            
            if (roughness < 0.01) {
                vec3 s = textureLod(uSourceTexture, N, 0.0).rgb;
                fragColor = vec4(min(decodeToLinear(s), vec3(${RG11B10_MAX}.0)), 1.0);
                return;
            }
            
            vec3 prefilteredColor = vec3(0.0);
            float totalWeight = 0.0;
            
            uint sampleCountUint = uint(sampleCount);
            float solidAnglePerTexel = 4.0 * PI / (6.0 * sourceSize * sourceSize);
            
            for (uint i = 0u; i < sampleCountUint; i++) {
                vec2 Xi = hammersley(i, sampleCountUint);
                vec3 H = importanceSampleGGX(Xi, N, roughness);
                vec3 L = normalize(2.0 * dot(V, H) * H - V);
                
                float NdotL = max(dot(N, L), 0.0);
                float lod = sourceLod(dot(N, H), roughness, solidAnglePerTexel);
                vec3 sampleColor = decodeToLinear(textureLod(uSourceTexture, L, lod).rgb);
                
                float weight = NdotL * step(0.0001, NdotL);
                prefilteredColor += sampleColor * weight;
                totalWeight += weight;
            }
            
            prefilteredColor = prefilteredColor / max(totalWeight, 1e-4);
            fragColor = vec4(min(prefilteredColor, vec3(${RG11B10_MAX}.0)), 1.0);
        }
      `,
  };

  const template: ShaderBitTemplate = {
    bindGroups: ['local'],
    gpu: gpuTemplate,
    gl: glTemplate,
  };

  const localBit: ShaderBit = {
    name: 'iblPrefilter',
    requires: [iblSamplingFuncsBit, decodeToLinearBit(!isLinearFormat(sourceTexture.source.format))],
    attributes: {
      aPosition: 'float32x2',
    },
    interStage: {
      vDir: 'vec3<f32>',
    },
    bindings: {
      local: {
        uSourceTexture: 'texture_cube<f32>',
        uSampler: 'sampler',
        layer: 'f32',
        mipLevel: 'f32',
        mipLevelCount: 'f32',
        sampleCount: 'f32',
        sourceSize: 'f32',
        sourceMaxMip: 'f32',
      },
    },
  };

  const cubeTextureSource = new TextureSource({
    label,
    width: size,
    height: size,
    viewDimension: 'cube',
    arrayLayerCount: 6,
    mipLevelCount,
    format,
  }) as CubeTextureSource;

  const localUniforms = new UniformGroup({
    layer: { value: 0, type: 'f32' },
    mipLevel: { value: 0, type: 'f32' },
    mipLevelCount: { value: mipLevelCount, type: 'f32' },
    sampleCount: { value: sampleCount, type: 'f32' },
    sourceSize: { value: sourceTexture.source.pixelWidth, type: 'f32' },
    sourceMaxMip: { value: sourceMipLevelCount(sourceTexture.source) - 1, type: 'f32' },
  });

  const localBindGroup = new BindGroup({
    local: localUniforms,
    uSourceTexture: sourceTexture.source,
    uSampler: sourceTexture.source.style,
  });

  const shader = renderer.material3d.compileIsolatedShader([localBit], template, {
    0: localBindGroup,
  });

  const geometry = fullscreenTriangleGeometry();

  const renderTarget = new RenderTarget({
    colorTextures: [cubeTextureSource],
  });

  const localUbo = shader.resources.local;

  const savedBind = renderer.renderTarget.renderTarget ? renderer.renderTarget.getBindState() : null;

  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < mipLevelCount; j++) {
      localUbo.uniforms.layer = i;
      localUbo.uniforms.mipLevel = j;

      const batchedUbo =
        'uniformBatch' in renderer.renderPipes ? renderer.renderPipes.uniformBatch.getUboResource(localUbo) : localUbo;

      localBindGroup.setResource(batchedUbo, 'local');

      renderer.renderTarget.bind({ target: renderTarget, clear: true, mipLevel: j, layer: i });

      renderer.encoder.draw({
        geometry,
        shader,
        state: State.default2d,
      });
    }
  }

  if (savedBind) renderer.renderTarget.bind(savedBind);

  localBindGroup.destroy();
  shader.destroy();
  renderTarget.destroy();

  return new CubeTexture({
    source: cubeTextureSource,
  });
}
