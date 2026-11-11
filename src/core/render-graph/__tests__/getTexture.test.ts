import { expectCleanRender, getApp } from '@test-utils';
import type { Renderer, Texture, WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { RenderGraph } from '~/core/render-graph/RenderGraph';
import type { ColorHandle, DepthHandle } from '~/core/render-graph/ResourceHandle';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import type { RenderSession } from '~/core/render-passes/RenderSession';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Pass3D } from '~/post-processing/Pass3D';
import type { PassContext } from '~/post-processing/Pass3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

interface DepthRead {
  texture: Texture;
  width: number;
  height: number;
  gpuFormat: string | null;
}

class DepthReaderPass extends Pass3D {
  public readonly stage = 'afterTransparent';
  public seen: DepthRead | null = null;
  private _late: (() => Texture) | null = null;

  public resolveAfterFrame(): Texture {
    return this._late!();
  }

  public build(graph: RenderGraph, ctx: PassContext): void {
    let depth: DepthHandle;

    graph.addPass({
      name: 'depthReader',
      bit: RenderPassBit.NONE,
      setup: (b) => {
        depth = b.read(ctx.opaqueDepth);
        b.sideEffect();
      },
      render: (session: RenderSession) => {
        const texture = graph.getTexture(depth, session);
        this._late = () => graph.getTexture(depth, session);
        const { frame, source } = texture;
        const gpu =
          session.renderer.name === 'webgpu'
            ? (session.renderer as WebGPURenderer).texture.getGpuSource(source).format
            : null;

        this.seen = {
          texture,
          width: Math.round(frame.width * source.resolution),
          height: Math.round(frame.height * source.resolution),
          gpuFormat: gpu,
        };
      },
    });
  }
}

class FrameEncoderReaderPass extends Pass3D {
  public readonly stage = 'afterTransparent';

  constructor(private readonly _texel: GPUBuffer) {
    super();
  }

  public build(graph: RenderGraph, ctx: PassContext): void {
    let color: ColorHandle;

    graph.addPass({
      name: 'frameEncoderReader',
      bit: RenderPassBit.NONE,
      setup: (b) => {
        color = b.read(ctx.opaqueColor);
        b.writeColor(b.targetColor);
        b.writeDepth(b.targetDepth);
      },
      render: (session: RenderSession) => {
        const renderer = session.renderer as WebGPURenderer;
        const { frame, source } = graph.getTexture(color, session);

        renderer.renderTarget.finishRenderPass();
        session.activeTarget = null;
        renderer.encoder.commandEncoder.copyTextureToBuffer(
          {
            texture: renderer.texture.getGpuSource(source),
            origin: {
              x: Math.floor((frame.x + frame.width / 2) * source.resolution),
              y: Math.floor((frame.y + frame.height / 2) * source.resolution),
            },
          },
          { buffer: this._texel },
          { width: 1, height: 1 },
        );
      },
    });
  }
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`RenderGraph.getTexture (${preference})`, () => {
    it('resolves a declared read to the live texture, with the content in its frame', async () => {
      const width = 48;
      const height = 32;
      const resolution = 2;
      const app = await getApp<Renderer>({
        id: `graph-get-texture-${preference}`,
        appOptions: { preference, width, height, resolution },
      });
      const view3d = new View3D({ toneMapping: 'none', width, height });
      const reader = new DepthReaderPass();

      try {
        expect(app.renderer.name).toBe(preference);
        app.stage.addChild(view3d);
        view3d.passes = [reader];
        view3d.camera.position.set(0, 0, 4);
        view3d.root.addChild(new Mesh3D({ geometry: new CubeGeometry(), material: new FlatMaterial() }));

        await expectCleanRender(app);

        const seen = reader.seen!;
        expect(seen, 'the pass rendered and resolved its read').not.toBeNull();
        expect({ width: seen.width, height: seen.height }).toEqual({
          width: width * resolution,
          height: height * resolution,
        });
        expect(seen.texture.source.pixelWidth).toBeGreaterThanOrEqual(width * resolution);
        expect(seen.texture.source.pixelHeight).toBeGreaterThanOrEqual(height * resolution);
        expect(seen.gpuFormat).toBe(preference === 'webgpu' ? 'depth24plus-stencil8' : null);

        expect(
          () => reader.resolveAfterFrame(),
          'after the frame the copy is back in the pool, and the error says so by name',
        ).toThrow(/'opaqueDepthCopy' isn't alive here/);
      } finally {
        view3d.destroy(true);
        reader.destroy();
        app.destroy();
      }
    });
  });
}

describe('RenderGraph.getTexture on the frame encoder (webgpu)', () => {
  it('reads the picture of the frame it runs in, and the frame stays valid', async () => {
    const app = await getApp<WebGPURenderer>({
      id: 'graph-get-texture-frame-encoder',
      appOptions: { preference: 'webgpu', width: 32, height: 32 },
    });
    const texel = app.renderer.gpu.device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const view3d = new View3D({ toneMapping: 'none', width: 32, height: 32 });
    const reader = new FrameEncoderReaderPass(texel);
    const material = new FlatMaterial({ baseColor: 0xff0000 });

    try {
      app.ticker.stop();
      app.stage.addChild(view3d);
      view3d.passes = [reader];
      view3d.camera.position.set(0, 0, 1.5);
      view3d.root.addChild(new Mesh3D({ geometry: new CubeGeometry(), material }));

      await expectCleanRender(app);
      material.baseColor = 0x00ff00;
      await expectCleanRender(app);

      await texel.mapAsync(GPUMapMode.READ);
      expect(
        Array.from(new Uint8Array(texel.getMappedRange())),
        'green, the colour this frame drew, not the red of the frame before',
      ).toEqual([0, 255, 0, 255]);
      texel.unmap();
    } finally {
      texel.destroy();
      view3d.destroy(true);
      reader.destroy();
      app.destroy();
    }
  });
});
