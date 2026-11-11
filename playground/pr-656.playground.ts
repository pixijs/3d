/// <reference types="@webgpu/types" />
import type { DepthHandle, PassContext, RenderGraph, RenderSession } from '@pixi/3d';
import {
  CubeGeometry,
  DirectionalLight,
  Material3D,
  Mesh3D,
  Pass3D,
  PlaneGeometry,
  SphereGeometry,
  View3D,
} from '@pixi/3d';
import type { Texture, TextureSource, WebGPURenderer } from 'pixi.js';
import { Application } from 'pixi.js';

import { rendererPreference } from './src/getPreference';

/** Reads one depth texel into a storage buffer: the smallest raw WebGPU use of a graph texture */
const PROBE_WGSL = /* wgsl */ `
@group(0) @binding(0) var sceneDepth: texture_depth_2d;
@group(0) @binding(1) var<uniform> probeTexel: vec2<u32>;
@group(0) @binding(2) var<storage, read_write> probeDepth: f32;

@compute @workgroup_size(1)
fn probe() {
  probeDepth = textureLoad(sceneDepth, probeTexel, 0);
}
`;

/** The probe's GPU objects, made on the first WebGPU frame because a `Pass3D` has no renderer before then */
interface ProbeResources {
  device: GPUDevice;
  pipeline: GPUComputePipeline;
  texel: Uint32Array;
  texelBuffer: GPUBuffer;
  depthBuffer: GPUBuffer;
  readBuffer: GPUBuffer;
  /** Built for one pooled source and kept while the pool hands the same source back */
  bindGroup: GPUBindGroup | null;
  boundSource: TextureSource | null;
  /** A copy into `readBuffer` is waiting to be mapped, so no new copy is recorded */
  reading: boolean;
}

function createProbeResources(device: GPUDevice): ProbeResources {
  const module = device.createShaderModule({ code: PROBE_WGSL });

  return {
    device,
    pipeline: device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'probe' } }),
    texel: new Uint32Array(2),
    texelBuffer: device.createBuffer({ size: 8, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
    depthBuffer: device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
    readBuffer: device.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    bindGroup: null,
    boundSource: null,
    reading: false,
  };
}

/**
 * Reads the opaque depth copy the way a temporal upscaler or SSAO pass would
 *
 * The graph pass declares the depth with `b.read`, so the graph binds nothing for it. The pass
 * resolves the texture with `graph.getTexture` inside `render`. It also declares writes to the
 * view's target, since the graph drops a pass that only reads. On WebGPU it records its compute
 * dispatch on the frame's command encoder, after the passes that drew the depth.
 */
class DepthProbePass extends Pass3D {
  public readonly stage = 'afterTransparent';
  /** The resolved texture's label, content rect, pooled size and format */
  public info = '';
  /** Depth at the centre of the view from the last readback, or `null` before the first */
  public centreDepth: number | null = null;

  private _gpu: ProbeResources | null = null;
  private _resolveLate: (() => Texture) | null = null;
  private _describedSource: TextureSource | null = null;
  private _describedWidth = 0;
  private _describedHeight = 0;

  public build(graph: RenderGraph, ctx: PassContext): void {
    let depth: DepthHandle;

    this._resolveLate = null;

    graph.addPass({
      name: 'depthProbe',
      setup: (b) => {
        depth = b.read(ctx.opaqueDepth);
        b.writeColor(b.targetColor);
        b.writeDepth(b.targetDepth);
      },
      render: (session: RenderSession) => {
        const texture = graph.getTexture(depth, session);

        this._resolveLate ??= () => graph.getTexture(depth, session);
        this._describe(texture);
        if (session.renderer.name === 'webgpu') this._probe(session.renderer as WebGPURenderer, session, texture);
      },
    });
  }

  /** Resolves the depth again outside `render`, where `getTexture` throws because the copy is back in the pool */
  public resolveAfterFrame(): string {
    try {
      this._resolveLate?.();

      return 'resolved outside render (unexpected)';
    } catch (error) {
      return (error as Error).message;
    }
  }

  public override destroy(): void {
    const gpu = this._gpu;

    this._gpu = null;
    this._resolveLate = null;
    this._describedSource = null;
    if (!gpu) return;
    gpu.texelBuffer.destroy();
    gpu.depthBuffer.destroy();
    gpu.readBuffer.destroy();
  }

  private _describe(texture: Texture): void {
    const { frame, source } = texture;

    if (
      source === this._describedSource &&
      frame.width === this._describedWidth &&
      frame.height === this._describedHeight
    ) {
      return;
    }
    this._describedSource = source;
    this._describedWidth = frame.width;
    this._describedHeight = frame.height;
    this.info =
      `texture: ${source.label}\n` +
      `content: ${Math.round(frame.width * source.resolution)} x ${Math.round(frame.height * source.resolution)} texels\n` +
      `pooled: ${source.pixelWidth} x ${source.pixelHeight}\n` +
      `format: ${source.format}`;
  }

  private _probe(renderer: WebGPURenderer, session: RenderSession, texture: Texture): void {
    const gpu = (this._gpu ??= createProbeResources(renderer.gpu.device));
    const { frame, source } = texture;

    if (gpu.boundSource !== source) {
      gpu.bindGroup = gpu.device.createBindGroup({
        layout: gpu.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: renderer.texture.getTextureView(texture, { aspect: 'depth-only' }) },
          { binding: 1, resource: { buffer: gpu.texelBuffer } },
          { binding: 2, resource: { buffer: gpu.depthBuffer } },
        ],
      });
      gpu.boundSource = source;
    }

    const x = Math.floor((frame.x + frame.width / 2) * source.resolution);
    const y = Math.floor((frame.y + frame.height / 2) * source.resolution);

    if (gpu.texel[0] !== x || gpu.texel[1] !== y) {
      gpu.texel[0] = x;
      gpu.texel[1] = y;
      gpu.device.queue.writeBuffer(gpu.texelBuffer, 0, gpu.texel);
    }

    renderer.renderTarget.finishRenderPass();

    const encoder = renderer.encoder.commandEncoder;
    const compute = encoder.beginComputePass();

    compute.setPipeline(gpu.pipeline);
    compute.setBindGroup(0, gpu.bindGroup);
    compute.dispatchWorkgroups(1);
    compute.end();
    session.activeTarget = null;

    if (gpu.reading) return;
    encoder.copyBufferToBuffer(gpu.depthBuffer, 0, gpu.readBuffer, 0, 4);
    gpu.reading = true;
    queueMicrotask(() => void this._readBack(gpu));
  }

  /**
   * Maps the copy once pixi has submitted the frame; a microtask queued in `render` runs after that
   * @param gpu - The resources whose read buffer holds the copy.
   */
  private async _readBack(gpu: ProbeResources): Promise<void> {
    try {
      await gpu.readBuffer.mapAsync(GPUMapMode.READ);
    } catch (error) {
      if (this._gpu !== gpu) return;
      throw error;
    }
    this.centreDepth = new Float32Array(gpu.readBuffer.getMappedRange())[0];
    gpu.readBuffer.unmap();
    gpu.reading = false;
  }
}

export default async function () {
  const app = new Application();

  await app.init({ resizeTo: window, preference: rendererPreference });
  document.body.appendChild(app.canvas);

  const view3d = new View3D({ autoResize: true });
  const probe = new DepthProbePass();

  app.stage.addChild(view3d);
  view3d.passes = [probe];

  const ball = new Mesh3D({
    geometry: new SphereGeometry({ radius: 0.5 }),
    material: new Material3D({ baseColor: 0xe0533d }),
  });
  const crate = new Mesh3D({ geometry: new CubeGeometry(), material: new Material3D({ baseColor: 0x3d7be0 }) });
  const wall = new Mesh3D({
    geometry: new PlaneGeometry({ width: 12, height: 8 }),
    material: new Material3D({ baseColor: 0xd8d2c4 }),
  });

  crate.position.set(-1.6, 0, -1);
  wall.position.z = -3;
  view3d.root.addChild(ball, crate, wall, new DirectionalLight({ intensity: 3 }));
  view3d.camera.position.set(0, 0, 5);

  const overlay = document.createElement('pre');
  const button = document.createElement('button');
  const error = document.createElement('pre');

  const panel = {
    position: 'fixed',
    left: '8px',
    margin: '0',
    padding: '8px',
    font: '12px monospace',
    color: '#fff',
    background: 'rgba(0, 0, 0, 0.6)',
  };

  Object.assign(overlay.style, panel, { top: '8px' });
  Object.assign(button.style, { position: 'fixed', top: '120px', left: '8px' });
  Object.assign(error.style, panel, { top: '150px', maxWidth: '480px', whiteSpace: 'pre-wrap' });
  error.hidden = true;
  button.textContent = 'getTexture after the frame';
  button.onclick = () => {
    error.textContent = probe.resolveAfterFrame();
    error.hidden = false;
  };
  document.body.append(overlay, button, error);

  const pending =
    app.renderer.name === 'webgpu' ? 'centre depth: waiting for the first readback' : 'compute probe: WebGPU only';
  let time = 0;

  app.ticker.add((ticker) => {
    time += ticker.deltaMS / 1000;
    ball.position.z = Math.sin(time) * 2;

    const depth = probe.centreDepth === null ? pending : `centre depth: ${probe.centreDepth.toFixed(5)}`;
    const text = `${probe.info}\n${depth}`;

    if (overlay.textContent !== text) overlay.textContent = text;
  });
}
