import { BindGroup, CubeTexture, RenderTarget, State, TextureSource, UniformGroup } from 'pixi.js';
import type { CubeTextureSource, WebGLRenderer, WebGPURenderer } from 'pixi.js';

import { fullscreenTriangleGeometry } from '../fullscreenTriangleGeometry';
import { iblSamplingFuncsBit } from '../shader/bits/iblSamplingFuncsBit';
import type { ShaderBit } from '../shader/ShaderBit';
import type { ShaderBitTemplate } from '../shader/ShaderBitTemplate';

/**
 * Storage format for the prefiltered cube
 *
 * With an environment set, every lit fragment samples the cube, so its bytes per texel set the IBL
 * bandwidth.
 * - `rgb10a2unorm`, 4 bytes: 10-bit linear, which keeps dark gradients free of the banding 8 bits
 *   would show. WebGPU and WebGL 2 both render to it and filter it with no extension. The
 *   default, since the prefilter of an 8-bit source stays within [0, 1].
 * - `rg11b10ufloat`, 4 bytes: compact linear HDR with no alpha. WebGPU needs the
 *   `rg11b10ufloat-renderable` feature and WebGL 2 needs `EXT_color_buffer_float`.
 * - `rgba16float`, 8 bytes: HDR that WebGPU renders to with no feature; WebGL 2 needs
 *   `EXT_color_buffer_float`.
 * @internal
 */
type IblCubemapFormat = 'rgb10a2unorm' | 'rg11b10ufloat' | 'rgba16float';

/**
 * Options for `generateIblSpecialCubemap`
 * @internal
 */
interface GenerateIblSpecialCubemapOptions {
  /** The renderer to generate with */
  renderer: WebGPURenderer | WebGLRenderer;
  /** The environment cubemap to prefilter */
  sourceTexture: CubeTexture;
  /** Output cubemap size (width/height per face). Default: 256 */
  size?: number;
  /** Number of Monte Carlo samples per pixel (higher = less noise, slower). Default: 1024 */
  sampleCount?: number;
  /**
   * Mip levels, one per roughness step
   *
   * Default `floor(log2(size)) - 3`, at least 1, which ends the chain at 16 × 16: five mips for
   * a 256 cube.
   */
  mipLevelCount?: number;
  /**
   * Cube storage format, `'rgb10a2unorm'` by default
   *
   * The caller checks that the device can render to a float format before passing one;
   * `IblCubemapFormat` lists what each needs.
   */
  format?: IblCubemapFormat;
  /** Texture label for debugging. Default: "ibl-specular" */
  label?: string;
}

/**
 * Prefilters an environment cubemap into the roughness-mipped specular cube IBL samples from
 *
 * Each mip holds one roughness step, from a mirror at mip 0 to fully rough at the last mip,
 * stored as linear radiance. Following Karis's split-sum prefilter, the shader takes the normal,
 * view and reflection directions to be the same, importance-samples GGX around that direction,
 * and weights each sample by `NdotL`. Mip 0 copies the source without filtering. Source texels
 * are decoded with a 2.2 gamma, so the average runs in linear light. Each sample reads source
 * mip `roughness * 4`, which only blurs further when the source has mips. The sum is divided
 * by at least 1e-4, because a NaN from 0 / 0 would stay in the mip for the texture's lifetime.
 *
 * The vertex stage turns the face index, in cube layer order +X, -X, +Y, -Y, +Z, -Z, and the clip
 * position into a direction. It stays unnormalised so it interpolates exactly, and the fragment
 * stage normalises it. Texture row 0 sits at clip y = +1 on WebGPU and at y = -1 on WebGL, so
 * the WGSL face mapping negates y and the GLSL one doesn't.
 *
 * Runs synchronously, restoring the caller's binding the way `generateBrdfLut` does.
 * @param options - Renderer and source cube plus size/samples/mips/format/label overrides.
 * @returns The prefiltered specular cubemap.
 * @internal
 */
export function generateIblSpecialCubemap(options: GenerateIblSpecialCubemapOptions): CubeTexture {
  const { renderer, sourceTexture } = options;

  const size = options.size ?? 256;
  const sampleCount = options.sampleCount ?? 1024;
  const label = options.label ?? 'ibl-specular';
  const format = options.format ?? 'rgb10a2unorm';

  const mipLevelCount = options.mipLevelCount ?? Math.max(1, Math.floor(Math.log2(size)) - 3);

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
            return vec4<f32>(pow(s, vec3<f32>(2.2)), 1.0);
        }
        
        var prefilteredColor = vec3<f32>(0.0);
        var totalWeight = 0.0;
        
        let sampleCount = u32(local.sampleCount);
        
        for (var i = 0u; i < sampleCount; i++) {
            let Xi = hammersley(i, sampleCount);
            let H = importanceSampleGGX(Xi, N, roughness);
            let L = normalize(2.0 * dot(V, H) * H - V);
            
            let NdotL = max(dot(N, L), 0.0);
            
            let mipBias = roughness * 4.0;
            let encoded = textureSampleLevel(uSourceTexture, uSampler, L, mipBias).rgb;
            let sampleColor = pow(encoded, vec3<f32>(2.2));
            
            let weight = NdotL * step(0.0001, NdotL);
            prefilteredColor += sampleColor * weight;
            totalWeight += weight;
        }
        
        prefilteredColor = prefilteredColor / max(totalWeight, 1e-4);
        
        return vec4<f32>(prefilteredColor, 1.0);
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

        void main() {
            vec3 N = normalize(vDir);
            vec3 R = N;
            vec3 V = R;
            
            float maxMipLevel = mipLevelCount - 1.0;
            float roughness = mipLevel / maxMipLevel;
            
            if (roughness < 0.01) {
                vec3 s = textureLod(uSourceTexture, N, 0.0).rgb;
                fragColor = vec4(pow(s, vec3(2.2)), 1.0);
                return;
            }
            
            vec3 prefilteredColor = vec3(0.0);
            float totalWeight = 0.0;
            
            uint sampleCountUint = uint(sampleCount);
            
            for (uint i = 0u; i < sampleCountUint; i++) {
                vec2 Xi = hammersley(i, sampleCountUint);
                vec3 H = importanceSampleGGX(Xi, N, roughness);
                vec3 L = normalize(2.0 * dot(V, H) * H - V);
                
                float NdotL = max(dot(N, L), 0.0);
                float mipBias = roughness * 4.0;

                vec3 encoded = textureLod(uSourceTexture, L, mipBias).rgb;
                vec3 sampleColor = pow(encoded, vec3(2.2));
                
                float weight = NdotL * step(0.0001, NdotL);
                prefilteredColor += sampleColor * weight;
                totalWeight += weight;
            }
            
            prefilteredColor = prefilteredColor / max(totalWeight, 1e-4);
            fragColor = vec4(prefilteredColor, 1.0);
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
      },
    },
  };

  const cubeTextureSource = new TextureSource({
    label,
    width: size,
    height: size,
    dimensions: '2d',
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
  });

  const localBindGroup = new BindGroup({
    0: localUniforms,
    1: sourceTexture.source,
    2: sourceTexture.source.style,
  });

  const shader = renderer.material3d.compileIsolatedShader([iblSamplingFuncsBit, localBit], template, {
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

      localBindGroup.setResource(batchedUbo, 0);

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
