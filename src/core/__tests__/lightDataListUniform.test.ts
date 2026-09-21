import { getApp } from '@test-utils';
import type { Application, WebGLRenderer, WebGPURenderer } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';

import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { PointLight } from '~/scene/lights/PointLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { FLOATS_PER_LIGHT, View3D } from '~/scene/View3D';

const RENDERERS = ['webgl', 'webgpu'] as const;

/** Offset of the range float within a light's row (layout on `LightDataList`) */
const RANGE = 7;

for (const preference of RENDERERS) {
  // oxlint-disable-next-line vitest/valid-title -- parametrising over both renderers by name
  describe(preference, () => {
    let app: Application<WebGLRenderer | WebGPURenderer> | undefined;

    afterEach(() => {
      app?.destroy();
      app = undefined;
    });

    it('binds the packed light list itself as the uLightData uniform', async () => {
      app = await getApp({ id: `light-list-uniform-${preference}`, appOptions: { preference } });

      const view = new View3D({ width: 64, height: 64 });
      const light = new PointLight({ intensity: 2, range: 5 });

      light.position.set(1, 2, 3);
      view.root.addChild(light);
      // A view with nothing to draw skips its lighting update.
      view.root.addChild(new Mesh3D({ geometry: new SphereGeometry({ radius: 1 }), material: new Material3D() }));
      app.stage.addChild(view);
      app.render();

      const uLightData = view._gpuData[app.renderer.uid].globalUniformGroup.uniforms.uLightData as Float32Array;

      // Same array, not a copy: packing a light is what writes the uniform.
      expect(uLightData).toBe(view._lightDataList.data);
      expect(view._lightDataList.count).toBe(1);
      expect(Array.from(uLightData.subarray(0, 3))).toEqual([1, 2, 3]);
      expect(uLightData[RANGE]).toBe(5);
    });

    it('packs each further light one stride along the uniform', async () => {
      app = await getApp({ id: `light-list-stride-${preference}`, appOptions: { preference } });

      const view = new View3D({ width: 64, height: 64 });
      const first = new PointLight({ intensity: 2, range: 5 });
      const second = new PointLight({ intensity: 2, range: 9 });

      first.position.set(1, 2, 3);
      second.position.set(-4, 6, -8);
      view.root.addChild(first);
      view.root.addChild(second);
      view.root.addChild(new Mesh3D({ geometry: new SphereGeometry({ radius: 1 }), material: new Material3D() }));
      app.stage.addChild(view);
      app.render();

      const uLightData = view._gpuData[app.renderer.uid].globalUniformGroup.uniforms.uLightData as Float32Array;

      expect(view._lightDataList.count).toBe(2);
      // Row 0 still holds the first light; the second sits a full stride along,
      // which is where the shader's `i * 4` vec4 step lands it.
      expect(Array.from(uLightData.subarray(0, 3))).toEqual([1, 2, 3]);
      expect(uLightData[RANGE]).toBe(5);
      expect(Array.from(uLightData.subarray(FLOATS_PER_LIGHT, FLOATS_PER_LIGHT + 3))).toEqual([-4, 6, -8]);
      expect(uLightData[FLOATS_PER_LIGHT + RANGE]).toBe(9);
    });
  });
}
