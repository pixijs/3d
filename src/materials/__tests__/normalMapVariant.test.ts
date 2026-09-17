import { getApp } from '@test-utils';
import { Texture } from 'pixi.js';
import type { Application, WebGLRenderer, WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { PhongMaterial } from '~/materials/phong/PhongMaterial';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

// Normal-mapping is a compile-time shader variant: the `normalMapping`/`tangentNormalMapping` bit is only
// compiled in when the normal slot holds a real map (not the flat NORMAL_MAP default). This proves that
// toggling the normal map AT RUNTIME recompiles to the right variant — i.e. the recompile is driven by the
// texture-swap dirty path, not by any normal-specific bookkeeping in the slot setter.
const hasNormalVariant = (app: Application<WebGLRenderer | WebGPURenderer>): boolean => {
  // Structural cast only to reach the material system's private shader cache.
  const materialSystem = app.renderer.material3d;
  return [...materialSystem['_shaderCache'].keys()].some((k) => /normalMapping/i.test(k));
};

describe('normal-map shader variant recompiles on a runtime texture swap', () => {
  it('compiles the normal-mapping variant only after a real normal map is assigned at runtime', async () => {
    const app = await getApp<WebGLRenderer | WebGPURenderer>({
      id: 'normal-variant',
      appOptions: { width: 256, height: 256 },
    });
    try {
      const view3d = new View3D({ width: 256, height: 256 });
      app.stage.addChild(view3d);

      const key = new DirectionalLight({ color: 0xffffff, intensity: 4 });
      key.rotation.set(-0.6, 0.6, 0);
      view3d.root.addChild(key);

      const cube = new Mesh3D({
        geometry: new CubeGeometry({ width: 2, height: 2, depth: 2 }),
        material: new Material3D({ baseColor: 0xff8844, metallic: 0.1, roughness: 0.5 }),
      });
      cube.rotation.set(-0.4, 0.6, 0);
      view3d.root.addChild(cube);
      view3d.camera.position.set(0, 0, 5);

      app.render();
      expect(hasNormalVariant(app)).toBe(false); // flat NORMAL_MAP default → no normal-mapping variant

      // Runtime toggle: assign a real map (any texture !== NORMAL_MAP flips the variant on).
      cube.material.textures.normal = Texture.WHITE;
      app.render();
      expect(hasNormalVariant(app)).toBe(true); // recompiled to the normal-mapping variant on the swap
    } finally {
      app.destroy();
    }
  });

  // The variant decision lives in the pipe, not the material, so every
  // BaseMaterial3D that reserves a normal slot inherits it. Proves an unmapped
  // PhongMaterial pays nothing for normal mapping: no sample, no TBN, no
  // screen-space derivatives are compiled in at all.
  it('gives PhongMaterial the same gating — no normal-mapping code until a real map is assigned', async () => {
    const app = await getApp<WebGLRenderer | WebGPURenderer>({
      id: 'normal-variant-phong',
      appOptions: { width: 256, height: 256 },
    });
    try {
      const view3d = new View3D({ width: 256, height: 256 });
      app.stage.addChild(view3d);

      const key = new DirectionalLight({ color: 0xffffff, intensity: 4 });
      key.rotation.set(-0.6, 0.6, 0);
      view3d.root.addChild(key);

      const cube = new Mesh3D({
        geometry: new CubeGeometry({ width: 2, height: 2, depth: 2 }),
        material: new PhongMaterial({ baseColor: 0xff8844, shininess: 48 }),
      });
      cube.rotation.set(-0.4, 0.6, 0);
      view3d.root.addChild(cube);
      view3d.camera.position.set(0, 0, 5);

      app.render();
      expect(hasNormalVariant(app)).toBe(false);

      cube.material.textures.normal = Texture.WHITE;
      app.render();
      expect(hasNormalVariant(app)).toBe(true);
    } finally {
      app.destroy();
    }
  });
});
