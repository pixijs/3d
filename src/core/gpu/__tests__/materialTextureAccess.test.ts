import { captureWarnings, getApp } from '@test-utils';
import type { WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { integerFieldsBit } from '~/core/shader/__tests__/integerFieldsBit';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/** The `flags` value `integerFieldsBit` tests for; its bits read as a denormal float, which a float round trip could flush to 0 */
const DENORMAL_BITS = 3;
/** The `offset` value `integerFieldsBit` tests for, which a wrong signed conversion would break */
const NEGATIVE_INTEGER = -2;

describe('material rows from the data texture in both stages, never a storage buffer (WebGPU)', () => {
  it('binds the store texture at 9, loads the row with textureLoad, and holds no storage read of it', async () => {
    const app = await getApp<WebGPURenderer>({
      id: 'material-texture-access',
      appOptions: { preference: 'webgpu', width: 64, height: 64 },
    });
    try {
      const view3d = new View3D({ width: 64, height: 64 });
      app.stage.addChild(view3d);
      const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
      view3d.root.addChild(new Mesh3D({ geometry, material: new Material3D({ baseColor: 0xffffff }) }));
      view3d.camera.position.set(0, 0, 4);

      expect(captureWarnings(() => app.render()).filter((w) => w.includes('[compileShader]'))).toEqual([]);

      const shaders = [...app.renderer.material3d._shaderCache.values()];
      const lit = shaders.map((s) => s.shader.gpuProgram!).find((p) => p.fragment?.source.includes('getMaterial('));
      expect(lit).toBeDefined();

      const source = lit!.fragment!.source;
      expect(source).toContain('@group(0) @binding(9) var uMaterialStorage: texture_2d<u32>;');
      expect(source).toContain('textureLoad(uMaterialStorage,');
      expect(source).not.toContain('var<storage, read> uMaterialStorage');
      expect(source).toContain('var material = getMaterial(vMaterialIndex);');
      expect(lit!.vertex!.source).toContain('var material = getMaterial(vMaterialIndex);');

      const entry = lit!.gpuLayout![0].find((e) => e.binding === 9);
      expect(entry?.texture?.sampleType, 'the rgba32uint store needs the uint sample type').toBe('uint');

      const pipe = app.renderer.renderPipes.view3d;
      const bound = view3d._gpuData[app.renderer.uid]!.globalBindGroup.resources[9];
      expect(bound, 'the global group binds the store texture, not its buffer').toBe(
        pipe.materialStoreBuffer.texture.source,
      );

      view3d.destroy({ children: true });
    } finally {
      app.destroy();
    }
  });

  it('draws each mesh in the colour of its own material row', async () => {
    const app = await getApp<WebGPURenderer>({
      id: 'material-texture-rows',
      appOptions: { preference: 'webgpu', width: 64, height: 64 },
    });
    try {
      const view3d = new View3D({ width: 64, height: 64 });
      app.stage.addChild(view3d);
      const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
      const red = new Mesh3D({ geometry, material: new FlatMaterial({ baseColor: 0xff0000 }) });
      red.position.set(-1, 0, 0);
      const blue = new Mesh3D({ geometry, material: new FlatMaterial({ baseColor: 0x0000ff }) });
      blue.position.set(1, 0, 0);
      view3d.root.addChild(red, blue);
      view3d.camera.position.set(0, 0, 4);
      view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

      const device = app.renderer.gpu.device;
      device.pushErrorScope('validation');
      app.render();
      const { pixels, width } = app.renderer.extract.pixels(view3d);
      expect(await device.popErrorScope()).toBeNull();

      const rgbAt = (x: number, y: number): number[] => [
        ...pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 3),
      ];
      expect(rgbAt(16, 32)).toEqual([255, 0, 0]);
      expect(rgbAt(48, 32)).toEqual([0, 0, 255]);

      view3d.destroy({ children: true });
    } finally {
      app.destroy();
    }
  });

  it('reads integer material fields exactly', async () => {
    const app = await getApp<WebGPURenderer>({
      id: 'material-texture-integer-fields',
      appOptions: { preference: 'webgpu', width: 64, height: 64 },
    });
    try {
      const view3d = new View3D({ width: 64, height: 64 });
      app.stage.addChild(view3d);
      view3d.camera.position.set(0, 0, 4);

      const material = new FlatMaterial({ baseColor: 0xffffff, extraBits: [integerFieldsBit] });
      material.data.flags = DENORMAL_BITS;
      material.data.offset = NEGATIVE_INTEGER;
      view3d.root.addChild(new Mesh3D({ geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }), material }));

      const device = app.renderer.gpu.device;
      const centre = (): number[] => {
        const { pixels, width } = app.renderer.extract.pixels(view3d);
        return [...pixels.subarray((32 * width + 32) * 4, (32 * width + 32) * 4 + 2)];
      };

      device.pushErrorScope('validation');
      expect(captureWarnings(() => app.render()).filter((w) => w.includes('[compileShader]'))).toEqual([]);
      const [red, green] = centre();
      material.data.flags = 4;
      material.data.offset = 2;
      app.render();
      const [redAfter, greenAfter] = centre();
      expect(await device.popErrorScope()).toBeNull();

      expect(red, 'flags reads 3').toBeGreaterThan(200);
      expect(green, 'offset reads -2').toBeGreaterThan(200);
      expect(redAfter, 'flags reads the new value').toBe(0);
      expect(greenAfter, 'offset reads the new value').toBe(0);

      view3d.destroy({ children: true });
    } finally {
      app.destroy();
    }
  });
});
