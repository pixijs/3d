import { getApp, renderFrame } from '@test-utils';
import { ShaderStage } from 'pixi.js';
import type { Application, WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 64;

function newApp(id: string, autoStart = true): Promise<Application<WebGPURenderer>> {
  return getApp<WebGPURenderer>({
    id,
    appOptions: { preference: 'webgpu', width: SIZE, height: SIZE, backgroundColor: 0x000000, autoStart },
  });
}

function addCube(app: Application<WebGPURenderer>, material: FlatMaterial): Mesh3D {
  const view3d = new View3D({ width: SIZE, height: SIZE });
  view3d.camera.position.set(0, 0, 3);
  const mesh = new Mesh3D({ geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }), material });
  view3d.root.addChild(mesh);
  app.stage.addChild(view3d);

  return mesh;
}

function materialWithTextures(n: number): FlatMaterial {
  const bit: ShaderBit = {
    name: `textureBudget${n}`,
    textures: Array.from({ length: n - 1 }, (_, i) => `t${i + 1}`),
  };

  return new FlatMaterial({ baseColor: 0xff0000, extraBits: [bit] });
}

function engineBindings(layout: GPUBindGroupLayoutEntry[][]): { textures: number; samplers: number } {
  let textures = 0;
  let samplers = 0;
  layout.forEach((entries, group) => {
    if (group === 2) return;
    for (const entry of entries) {
      if (!(entry.visibility & ShaderStage.VERTEX)) continue;
      if (entry.texture) textures++;
      if (entry.sampler) samplers++;
    }
  });

  return { textures, samplers };
}

describe('WebGPU material texture budget', () => {
  it("draws a material at the device's texture budget and names one over it before WebGPU sees its layout", async () => {
    const globalsApp = await newApp('texture-budget-globals');
    let engine: { textures: number; samplers: number };
    let limits: Pick<GPUSupportedLimits, 'maxSamplersPerShaderStage' | 'maxSampledTexturesPerShaderStage'>;
    try {
      const mesh = addCube(globalsApp, new FlatMaterial({ baseColor: 0xff0000 }));
      globalsApp.render();
      engine = engineBindings(mesh._passCache[RenderPassBit.OPAQUE].shader.gpuProgram.gpuLayout);
      const { maxSamplersPerShaderStage, maxSampledTexturesPerShaderStage } = globalsApp.renderer.gpu.device.limits;
      limits = { maxSamplersPerShaderStage, maxSampledTexturesPerShaderStage };
    } finally {
      globalsApp.destroy();
    }

    const samplerRoom = limits.maxSamplersPerShaderStage - engine.samplers;
    const textureRoom = limits.maxSampledTexturesPerShaderStage - engine.textures;
    const budget = Math.min(samplerRoom, textureRoom);
    const tighter = samplerRoom <= textureRoom ? 'maxSamplersPerShaderStage' : 'maxSampledTexturesPerShaderStage';

    const atBudgetApp = await newApp('texture-budget-at');
    try {
      addCube(atBudgetApp, materialWithTextures(budget));
      const pixels = await renderFrame(atBudgetApp);
      const centre = ((SIZE >> 1) * SIZE + (SIZE >> 1)) * 4;
      expect(pixels[centre] + pixels[centre + 1] + pixels[centre + 2], `${budget} textures draw`).toBeGreaterThan(0);
    } finally {
      atBudgetApp.destroy();
    }

    const overApp = await newApp('texture-budget-over', false);
    try {
      addCube(overApp, materialWithTextures(budget + 1));
      const device = overApp.renderer.gpu.device;
      device.pushErrorScope('validation');

      let thrown: unknown = null;
      try {
        overApp.render();
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `${budget + 1} textures`).toBeInstanceOf(Error);
      const message = (thrown as Error).message;
      for (const part of ['FlatMaterial', tighter, String(limits[tighter]), 't1', String(budget + 1)]) {
        expect(message).toContain(part);
      }

      expect((await device.popErrorScope())?.message ?? null, 'no pipeline layout was ever created').toBe(null);
    } finally {
      overApp.destroy();
    }
  });
});
