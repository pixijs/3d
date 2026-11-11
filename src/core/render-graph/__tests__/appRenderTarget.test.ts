import { getApp } from '@test-utils';
import { RenderTarget, TextureSource } from 'pixi.js';
import type { Application, Renderer } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`a view rendered into the app's own render target (${preference})`, () => {
    let app: Application<Renderer>;
    let view3d: View3D;
    let target: RenderTarget;

    afterEach(() => {
      view3d?.destroy(true);
      target?.destroy();
      app?.destroy();
    });

    it('draws into a target with two colour attachments and leaves their settings alone', async () => {
      app = await getApp<Renderer>({
        id: `app-render-target-${preference}`,
        appOptions: { preference, width: 32, height: 32, autoStart: false },
      });
      view3d = new View3D({ width: 32, height: 32 });
      view3d.camera.position.set(0, 0, 4);
      view3d.root.addChild(new Mesh3D({ geometry: new CubeGeometry(), material: new FlatMaterial() }));

      target = new RenderTarget({
        colorTextures: [new TextureSource({ width: 32, height: 32 }), new TextureSource({ width: 32, height: 32 })],
        depth: true,
      });
      const second = target.colorAttachments[1];
      second.clearValue = [0, 1, 0, 1];
      second.loadOp = 'load';

      expect(() => app.renderer.render({ container: view3d, target })).not.toThrow();
      expect(second.clearValue, "the app's clear value on its second attachment").toEqual([0, 1, 0, 1]);
      expect(second.loadOp, "the app's load op on its second attachment").toBe('load');
    });
  });
}
