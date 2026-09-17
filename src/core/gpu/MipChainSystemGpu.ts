import { ExtensionType } from 'pixi.js';
import type { TextureSource, WebGPURenderer } from 'pixi.js';

const MIP_DOWNSAMPLE_WGSL = /* wgsl */ `
  var<private> pos: array<vec2<f32>, 3> = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(-1.0, 3.0), vec2<f32>(3.0, -1.0));

  struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) texCoord: vec2<f32>,
  };

  @vertex
  fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var output: VertexOutput;
    output.texCoord = pos[vertexIndex] * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5);
    output.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
    return output;
  }

  @group(0) @binding(0) var imgSampler: sampler;
  @group(0) @binding(1) var img: texture_2d<f32>;

  @fragment
  fn fragmentMain(@location(0) texCoord: vec2<f32>) -> @location(0) vec4<f32> {
    return textureSample(img, imgSampler, texCoord);
  }
`;

/** Cached per-mip render targets + bind groups for one source */
interface MipCacheEntry {
  readonly bindGroups: GPUBindGroup[];
  readonly dstViews: GPUTextureView[];
}

/**
 * Regenerates a colour texture's mip chain (levels 1+ from level 0) in-band
 *
 * Records per-level fullscreen-triangle downsamples into the renderer's current
 * frame encoder, no submit. In-band — not Pixi's `GpuMipmapGenerator`, which
 * submits on its own encoder and would mip stale contents (the one-frame glass
 * flicker with a shared pool) — so copy → mip-gen → sample stay one ordered
 * submission. The graph calls it after a mip-chained colour's last writer.
 *
 * Caches the per-format pipeline + sampler, and each source's views/bind groups
 * keyed by uid (a pooled copy crossing a pow2 bucket is a new source/uid).
 * Registered as a WebGPU renderer system (`renderer.mipChain3d`).
 * @internal
 */
export class MipChainSystemGpu {
  /** @ignore */
  public static extension = {
    type: [ExtensionType.WebGPUSystem],
    name: 'mipChain3d',
  } as const;

  private readonly _renderer: WebGPURenderer;
  private _shaderModule: GPUShaderModule | null = null;
  private _sampler: GPUSampler | null = null;
  private _pipelines: Record<string, GPURenderPipeline> = Object.create(null);
  private _cache: Record<number, MipCacheEntry> = Object.create(null);

  constructor(renderer: WebGPURenderer) {
    this._renderer = renderer;
  }

  /**
   * Record `source`'s mip levels 1+ into the current frame encoder; no-op for single-level textures
   * @param source - The texture whose mip chain gets filled from level 0
   */
  public generate(source: TextureSource): void {
    if (source.mipLevelCount <= 1) return;

    const device = this._renderer.gpu.device;
    const encoder = this._renderer.encoder.commandEncoder;
    const pipeline = this._pipeline(device, source.format as GPUTextureFormat);

    // Views/bind groups bind the texture, not its contents — built once per uid,
    // reused; the live mip is read at draw time.
    const { bindGroups, dstViews } = this._cache[source.uid] || this._buildCacheEntry(source);

    for (let i = 0; i < dstViews.length; i++) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view: dstViews[i], loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroups[i]);
      pass.draw(3);
      pass.end();
    }
  }

  private _buildCacheEntry(source: TextureSource): MipCacheEntry {
    const device = this._renderer.gpu.device;
    const pipeline = this._pipeline(device, source.format as GPUTextureFormat);

    const gpuTexture = this._renderer.texture.getGpuSource(source);

    const bindGroups: GPUBindGroup[] = [];
    const dstViews: GPUTextureView[] = [];
    const layout = pipeline.getBindGroupLayout(0);
    for (let mip = 1; mip < source.mipLevelCount; mip++) {
      dstViews.push(gpuTexture.createView({ baseMipLevel: mip, mipLevelCount: 1, dimension: '2d' }));
      bindGroups.push(
        device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: this._sampler! },
            {
              binding: 1,
              resource: gpuTexture.createView({ baseMipLevel: mip - 1, mipLevelCount: 1, dimension: '2d' }),
            },
          ],
        }),
      );
    }

    const entry = { bindGroups, dstViews };
    this._cache[source.uid] = entry;

    return entry;
  }

  private _pipeline(device: GPUDevice, format: GPUTextureFormat): GPURenderPipeline {
    const cached = this._pipelines[format];
    if (cached) return cached;

    this._shaderModule ||= device.createShaderModule({ code: MIP_DOWNSAMPLE_WGSL });
    this._sampler ||= device.createSampler({ minFilter: 'linear' });

    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: this._shaderModule, entryPoint: 'vertexMain' },
      fragment: { module: this._shaderModule, entryPoint: 'fragmentMain', targets: [{ format }] },
    });
    this._pipelines[format] = pipeline;
    return pipeline;
  }

  /**
   * Drop references to the cached WebGPU objects
   *
   * The pipelines, shader module, sampler, views, and bind groups are garbage-collected with
   * the device, so teardown only clears the caches to release them.
   */
  public destroy(): void {
    this._shaderModule = null;
    this._sampler = null;
    this._pipelines = Object.create(null);
    this._cache = Object.create(null);
  }
}

declare global {
  namespace PixiMixins {
    interface WebGPUSystems {
      /** In-band mip-chain regeneration for pooled colour copies */
      mipChain3d: MipChainSystemGpu;
    }
  }
}
