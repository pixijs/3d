import { BindGroup, CubeTexture, Geometry, RenderTarget, State, TextureSource, UniformGroup } from 'pixi.js';
import type { CubeTextureSource, WebGLRenderer, WebGPURenderer } from 'pixi.js';

import { iblSamplingFuncsBit } from '../shader/bits/iblSamplingFuncsBit';
import type { ShaderBit } from '../shader/ShaderBit';
import type { ShaderBitTemplate } from '../shader/ShaderBitTemplate';

/**
 * Storage format for the prefiltered cube
 *
 * All three are 4 bytes/texel except `rgba16float` (8); the cube is sampled
 * several times per fragment, so the format directly drives IBL sample
 * bandwidth.
 * - `rgb10a2unorm` — 10-bit linear LDR. Core-renderable + filterable on both
 *   WebGPU and WebGL2, no extension. Default: ideal for the (LDR) prefilter,
 *   whose output stays in [0, 1]; 10-bit kills the dark-gradient banding 8-bit
 *   linear would show.
 * - `rg11b10ufloat` — compact linear HDR (no alpha — unused here). WebGPU needs
 *   the `rg11b10ufloat-renderable` device feature; WebGL2 needs
 *   `EXT_color_buffer_float`. Use for HDR sources.
 * - `rgba16float` — float HDR, 8 bytes/texel. Core-renderable on WebGPU; WebGL2
 *   needs `EXT_color_buffer_float`. The universal HDR fallback.
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
  /** Number of mip levels (roughness steps). Default: calculated from size */
  mipLevelCount?: number;
  /**
   * Cube storage format
   *
   * Default `'rgb10a2unorm'` (see `IblCubemapFormat`). Must be renderable on the
   * active device: the caller checks the WebGPU feature / WebGL2 extension a
   * float format needs.
   */
  format?: IblCubemapFormat;
  /** Texture label for debugging. Default: "ibl-specular" */
  label?: string;
}

/**
 * Prefilters an environment cubemap into the roughness-mipped specular cube IBL samples from
 *
 * GGX importance-samples the source per face, one mip per roughness step
 * (mip 0 = mirror, last mip = roughest), storing linear radiance. Runs
 * synchronously on the given renderer and restores the caller's render-target
 * binding afterwards.
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

  // Calculate mip levels: enough to cover roughness range, typically down to ~16x16
  // For size=256: log2(256)-3 = 5 mips (256, 128, 64, 32, 16)
  const mipLevelCount = options.mipLevelCount ?? Math.max(1, Math.floor(Math.log2(size)) - 3);

  const gpuTemplate = /* wgsl */ `
     {{header}}

     // Convert cube face index and UV to 3D direction
     fn getDirection(face: i32, pos: vec2<f32>) -> vec3<f32> {
        let u = pos.x;
        let v = -pos.y;
        
        var dir = vec3<f32>(0.0);
        
        switch face {
            case 0: { dir = vec3<f32>(1.0, -v, -u); }   // +X
            case 1: { dir = vec3<f32>(-1.0, -v, u); }   // -X
            case 2: { dir = vec3<f32>(u, 1.0, v); }     // +Y
            case 3: { dir = vec3<f32>(u, -1.0, -v); }   // -Y
            case 4: { dir = vec3<f32>(u, -v, 1.0); }    // +Z
            default: { dir = vec3<f32>(-u, -v, -1.0); } // -Z
        }

        return normalize(dir);
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
        let R = N;  // Reflection vector equals normal for prefiltering
        let V = R;  // View direction equals reflection for prefiltering
        
        // Convert mip level to roughness (0 = smooth, 1 = rough)
        let maxMipLevel = f32(local.mipLevelCount) - 1.0;
        let roughness = local.mipLevel / maxMipLevel;
        
        // For mip 0 (roughness = 0), just sample the environment directly.
        // Gamma-2.2 sRGB decode so the stored cube holds linear radiance.
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
            
            // Sample with mip bias to reduce aliasing at high roughness
            // For rough surfaces, sample from blurrier mips of source
            let mipBias = roughness * 4.0;
            // Gamma-2.2 sRGB decode so the GGX average runs in linear light.
            let encoded = textureSampleLevel(uSourceTexture, uSampler, L, mipBias).rgb;
            let sampleColor = pow(encoded, vec3<f32>(2.2));
            
            // Use step to avoid branching - step(0.0, NdotL) returns 1 if NdotL > 0, else 0
            let weight = NdotL * step(0.0001, NdotL);
            prefilteredColor += sampleColor * weight;
            totalWeight += weight;
        }
        
        prefilteredColor = prefilteredColor / totalWeight;
        
        return vec4<f32>(prefilteredColor, 1.0);
     }
  `;

  const glTemplate = {
    vertex: /* glsl */ `#version 300 es
        precision highp float;
        precision highp sampler2D;
        precision highp samplerCube;
        {{header}}

        // Convert cube face index and UV to 3D direction
        // WebGL framebuffer row 0 is at the bottom (clip Y=-1), so v = pos.y
        // (unlike WebGPU where row 0 is at the top, needing v = -pos.y).
        vec3 getDirection(int face, vec2 pos) {
            float u = pos.x;
            float v = pos.y;
            
            vec3 dir = vec3(0.0);
            
            switch(face) {
                case 0: dir = vec3(1.0, -v, -u); break;   // +X
                case 1: dir = vec3(-1.0, -v, u); break;   // -X
                case 2: dir = vec3(u, 1.0, v); break;     // +Y
                case 3: dir = vec3(u, -1.0, -v); break;   // -Y
                case 4: dir = vec3(u, -v, 1.0); break;    // +Z
                default: dir = vec3(-u, -v, -1.0); break; // -Z
            }

            return normalize(dir);
        }

        void main() {
            gl_Position = vec4(aPosition, 0.0, 1.0);
            vDir = getDirection(int(layer + 0.5), aPosition);
        }
      `,
    fragment: /* glsl */ `#version 300 es
        precision highp float;
        precision highp sampler2D;
        precision highp int;
        precision highp samplerCube;
        {{header}}

        out vec4 fragColor;

        void main() {
            vec3 N = normalize(vDir);
            vec3 R = N;
            vec3 V = R;
            
            float maxMipLevel = mipLevelCount - 1.0;
            float roughness = mipLevel / maxMipLevel;
            
            if (roughness < 0.01) {
                // Gamma-2.2 sRGB decode so the stored cube holds linear radiance.
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

                // Gamma-2.2 sRGB decode so the GGX average runs in linear light.
                vec3 encoded = textureLod(uSourceTexture, L, mipBias).rgb;
                vec3 sampleColor = pow(encoded, vec3(2.2));
                
                float weight = NdotL * step(0.0001, NdotL);
                prefilteredColor += sampleColor * weight;
                totalWeight += weight;
            }
            
            prefilteredColor = prefilteredColor / totalWeight;
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
    // Linear radiance store. A 10-bit/float format avoids the banding 8-bit
    // linear would show; see IblCubemapFormat for the per-format trade-offs.
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

  const geometry = new Geometry({
    attributes: {
      aPosition: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    },
    topology: 'triangle-strip',
  });

  const renderTarget = new RenderTarget({
    colorTextures: [cubeTextureSource],
  });

  const localUbo = shader.resources.local;

  // Capture the caller's live binding and replay it after the faces are rendered,
  // rather than push/pop: pop() restores the render-target stack's top, but a 2D
  // filter binds its input texture off the stack (FilterSystem uses bind, not push),
  // so pop() would snap back to the screen. The per-face bind below sets our target
  // each iteration, so no initial bind is needed here.
  // Null when nothing is bound yet (a standalone call outside a render).
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

  return new CubeTexture({
    source: cubeTextureSource,
  });
}
