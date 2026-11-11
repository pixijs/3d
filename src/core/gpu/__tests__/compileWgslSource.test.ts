import { getApp } from '@test-utils';
import type { WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

import { compilationErrors } from './compilationErrors';

describe('compileWgslSource, checked by the device: CI skips WebGPU scenes, but Tint validates even on its adapter', () => {
  it('the device compiles every material module, and each starts with the directive', async () => {
    const app = await getApp<WebGPURenderer>({
      id: 'compile-wgsl-source',
      appOptions: { preference: 'webgpu', width: 64, height: 64 },
    });
    try {
      const view3d = new View3D({ width: 64, height: 64 });
      app.stage.addChild(view3d);
      const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
      view3d.root.addChild(new Mesh3D({ geometry, material: new Material3D({ baseColor: 0xffffff }) }));
      view3d.camera.position.set(0, 0, 4);
      app.render();

      const programs = [...app.renderer.material3d._shaderCache.values()].map((s) => s.shader.gpuProgram);
      expect(programs.length).toBeGreaterThan(0);
      for (const program of programs) {
        const source = program.fragment!.source;
        expect(await compilationErrors(app.renderer.gpu.device, source)).toEqual([]);
        expect(source.startsWith('diagnostic(off, derivative_uniformity);')).toBe(true);
      }

      view3d.destroy({ children: true });
    } finally {
      app.destroy();
    }
  });
});
