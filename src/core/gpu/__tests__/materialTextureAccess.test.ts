import { captureWarnings, getApp } from '@test-utils';
import { Texture } from 'pixi.js';
import type { WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { integerFieldsBit } from '~/core/shader/__tests__/integerFieldsBit';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const DENORMAL_BITS = 3;
const NEGATIVE_INTEGER = -2;

describe('material data from the data texture in both stages, never a storage buffer (WebGPU)', () => {
  it('the merged shader binds the store texture as `uMaterialStorage`, loads the material with textureLoad, and holds no storage read of it', async () => {
    const app = await getApp<WebGPURenderer>({
      id: 'material-texture-access',
      appOptions: { preference: 'webgpu', width: 64, height: 64 },
    });
    try {
      const view3d = new View3D({ toneMapping: 'none', width: 64, height: 64 });
      app.stage.addChild(view3d);
      const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
      const mesh = new Mesh3D({ geometry, material: new Material3D({ baseColor: 0xffffff }) });
      view3d.root.addChild(mesh);
      view3d.camera.position.set(0, 0, 4);

      expect(captureWarnings(() => app.render()).filter((w) => w.includes('[compileShader]'))).toEqual([]);

      const material3d = app.renderer.material3d;
      const direct = [...material3d._shaderCache.values()];
      expect(
        direct.some((s) => s.shader.gpuProgram.fragment?.source.includes('getMaterial(')),
        'a scene that never merges compiles no merged shader',
      ).toBe(false);

      const merged = material3d.ensureMergedShader(mesh, view3d._sceneBatch, view3d);
      expect(material3d.ensureMergedShader(mesh, view3d._sceneBatch, view3d), 'cached on the pass entry').toBe(merged);
      expect(mesh._passCache[mesh.material._passBit].mergedShader).toBe(merged);
      expect(material3d._shaderCache.size).toBe(direct.length + 1);

      const lit = merged.gpuProgram;
      const source = lit.fragment!.source;
      expect(source).not.toContain('var<uniform> material');
      expect(source).toContain('@group(0) @binding(9) var uMaterialStorage: texture_2d<u32>;');
      expect(source).toContain('textureLoad(uMaterialStorage,');
      expect(source).not.toContain('var<storage, read> uMaterialStorage');
      expect(source).toContain('var material = getMaterial(vMaterialIndex);');
      expect(lit.vertex!.source).toContain('var material = getMaterial(vMaterialIndex);');

      const entry = lit.gpuLayout[0].find((e) => e.binding === 9);
      expect(entry?.texture?.sampleType, 'the rgba32uint store needs the uint sample type').toBe('uint');

      const pipe = app.renderer.renderPipes.view3d;
      const bound = view3d._gpuData[app.renderer.uid].globalBindGroup.getResource('uMaterialStorage');
      expect(bound, 'the global group binds the store texture, not its buffer').toBe(
        pipe.materialStoreBuffer.texture.source,
      );

      mesh.material.textures.baseColor = Texture.EMPTY;
      app.render();
      expect(
        mesh._passCache[mesh.material._passBit].mergedShader,
        'a texture change drops it with the direct shader',
      ).toBe(null);

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
      const view3d = new View3D({ toneMapping: 'none', width: 64, height: 64 });
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
