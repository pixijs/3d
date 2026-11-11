import { getApp } from '@test-utils';
import type { WebGLRenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

function readCenter(app: { renderer: unknown }): [number, number, number] {
  const gl = (app.renderer as { gl: WebGL2RenderingContext }).gl;
  const out = new Uint8Array(4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(gl.drawingBufferWidth / 2, gl.drawingBufferHeight / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return [out[0], out[1], out[2]];
}

describe('morph live weight updates (WebGL)', () => {
  it('re-renders when weights change after the data textures were created empty', async () => {
    const app = await getApp<WebGLRenderer>({
      id: 'morph-gl-live-update',
      appOptions: { preference: 'webgl', width: 64, height: 64, backgroundColor: 0x000000 },
    });
    try {
      const view3d = new View3D({ width: 64, height: 64 });
      app.stage.addChild(view3d);
      view3d.camera.position.set(0, 0, 2.6);

      const light = new DirectionalLight({ color: 0xffffff, intensity: 9 });
      light.rotation.set(0.18, 0.12, 0);
      view3d.root.addChild(light);

      app.render();
      app.render();

      const geometry = new Geometry3D({
        positions: new Float32Array([-2, -2, 0, 2, -2, 0, 0, 2.5, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
        morphTargets: [{ positions: new Float32Array([50, 0, 0, 50, 0, 0, 50, 0, 0]) }],
      });
      const mesh = new Mesh3D({
        geometry,
        material: new Material3D({ baseColor: 0x4a7c59, metallic: 0, roughness: 0.5, doubleSided: true }),
        castShadow: false,
        receiveShadow: false,
      });
      view3d.root.addChild(mesh);

      app.render();
      const basePose = readCenter(app);
      expect(basePose[1], 'the triangle covers the centre, lit, at weight 0').toBeGreaterThan(20);

      mesh.weights![0] = 1;
      app.render();
      app.render();

      const pipe = app.renderer.renderPipes.view3d;
      const store = pipe._morphStoreBuffer;
      expect(store.data[mesh._morph!._weightIndex], 'the store took the new weight').toBe(1);

      const morphed = readCenter(app);
      expect(morphed[1], 'the GPU saw it: the morph target moved the triangle off-screen').toBeLessThan(10);
    } finally {
      app.destroy();
    }
  });
});
