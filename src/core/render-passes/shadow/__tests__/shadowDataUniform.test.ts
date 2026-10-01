import { getApp } from '@test-utils';
import type { Application, WebGLRenderer, WebGPURenderer } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';

import { FLOATS_PER_SHADOW_SLOT } from '~/core/ShadowDataList';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const RENDERERS = ['webgl', 'webgpu'] as const;

/** Offset of the shadow-map size float within a slot (layout on `ShadowDataList`) */
const MAP_SIZE = 18;

/**
 * The 16 light-space matrix floats a slot holds, column-major as both backends rebuild them
 * @param uShadowData - The `uShadowData` uniform value
 * @param slot - Slot index, in `FLOATS_PER_SHADOW_SLOT` strides
 */
function slotMatrix(uShadowData: Float32Array, slot: number): number[] {
  const m = slot * FLOATS_PER_SHADOW_SLOT;

  return Array.from(uShadowData.subarray(m, m + 16));
}

/**
 * Asserts a slot holds a usable orthographic light-space matrix for a caster at the world origin
 *
 * The matrix's last column is where the world origin lands. A directional light's matrix is
 * orthographic, so its `w` is 1, and the caster the pass fitted the box around sits inside the
 * shadow map. A slot left unwritten or written at the wrong offset fails here.
 * @param uShadowData - The `uShadowData` uniform value
 * @param slot - Slot index, in `FLOATS_PER_SHADOW_SLOT` strides
 */
function expectFittedOrthoSlot(uShadowData: Float32Array, slot: number): void {
  const [x, y, , w] = slotMatrix(uShadowData, slot).slice(12);

  expect(w).toBeCloseTo(1);
  expect(Math.abs(x)).toBeLessThanOrEqual(1);
  expect(Math.abs(y)).toBeLessThanOrEqual(1);
  expect(uShadowData[slot * FLOATS_PER_SHADOW_SLOT + MAP_SIZE]).toBeGreaterThan(0);
}

/** A sphere at the origin for the shadow pass to fit its box around */
function caster(): Mesh3D {
  return new Mesh3D({ geometry: new SphereGeometry({ radius: 1 }), material: new Material3D() });
}

for (const preference of RENDERERS) {
  // oxlint-disable-next-line vitest/valid-title -- parametrising over both renderers by name
  describe(preference, () => {
    let app: Application<WebGLRenderer | WebGPURenderer> | undefined;

    afterEach(() => {
      app?.destroy();
      app = undefined;
    });

    it('binds the packed shadow list itself as the uShadowData uniform', async () => {
      app = await getApp({ id: `shadow-data-uniform-${preference}`, appOptions: { preference } });

      const view = new View3D({ width: 64, height: 64 });
      const sun = new DirectionalLight({ intensity: 3, castShadow: true });

      sun.position.set(5, 8, 5);
      sun.lookAt({ x: 0, y: 0, z: 0 });
      view.root.addChild(sun);
      view.root.addChild(caster());
      app.stage.addChild(view);
      app.render();

      const uShadowData = view._gpuData[app.renderer.uid].globalUniformGroup.uniforms.uShadowData;

      expect(uShadowData, 'the same array, so writing a slot writes the uniform').toBe(view._shadowDataList.data);
      expect(view._shadowDataList.count).toBe(1);
      expect(sun._shadowDataIndex).toBe(0);
      expectFittedOrthoSlot(uShadowData, 0);
    });

    it('gives each further caster the next slot, a full stride along the uniform rather than over the first slot or its params', async () => {
      app = await getApp({ id: `shadow-data-stride-${preference}`, appOptions: { preference } });

      const view = new View3D({ width: 64, height: 64 });
      const first = new DirectionalLight({ intensity: 3, castShadow: true });
      const second = new DirectionalLight({ intensity: 3, castShadow: true });

      first.position.set(5, 8, 5);
      first.lookAt({ x: 0, y: 0, z: 0 });
      second.position.set(-6, 7, -4);
      second.lookAt({ x: 0, y: 0, z: 0 });
      view.root.addChild(first);
      view.root.addChild(second);
      view.root.addChild(caster());
      app.stage.addChild(view);
      app.render();

      const uShadowData = view._gpuData[app.renderer.uid].globalUniformGroup.uniforms.uShadowData;

      expect(first._shadowDataIndex).toBe(0);
      expect(second._shadowDataIndex).toBe(1);

      expectFittedOrthoSlot(uShadowData, 0);
      expectFittedOrthoSlot(uShadowData, 1);

      expect(
        slotMatrix(uShadowData, 1),
        'the suns look from opposite sides, so slot 1 is no copy of slot 0',
      ).not.toEqual(slotMatrix(uShadowData, 0));
    });
  });
}
