import { getApp, isCI } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Box } from '~/math/shapes/Box';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import type { LightShadowOptions } from '~/scene/lights/Light';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;

// `bounds` and `cascades` are mutually exclusive placement modes. The options type rejects
// combining them (and cascade-only tuning without cascades) at compile time; runtime mutation
// can still produce the combined state, where cascades win and a one-time warn says so.
describe('shadow options exclusivity (compile time)', () => {
  it('rejects mixed placement modes', () => {
    // @ts-expect-error — bounds and cascades are mutually exclusive
    const both: LightShadowOptions = { bounds: Box.fromCenterSize({ x: 0, y: 0, z: 0 }, 10), cascades: 3 };
    // @ts-expect-error — maxDistance is cascade-only
    const maxAlone: LightShadowOptions = { maxDistance: 25 };
    // @ts-expect-error — per-cascade update arrays require cascades
    const arrayAlone: LightShadowOptions = { update: [1, 2] };

    const fixed: LightShadowOptions = { bounds: Box.fromCenterSize({ x: 0, y: 0, z: 0 }, 10), update: 'manual' };
    const cascaded: LightShadowOptions = { cascades: 3, maxDistance: 25, lambda: 0.6, update: [1, 2, 4] };
    expect([both, maxAlone, arrayAlone, fixed, cascaded]).toBeDefined();
  });
});

for (const preference of ['webgpu', 'webgl'] as const) {
  describe.skipIf(isCI)(`shadow bounds+cascades warn (${preference})`, () => {
    it('warns once when mutation sets both, and cascades keep precedence', async () => {
      const app = await getApp<Renderer>({
        id: `shadow-config-warn-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });
      const warnSpy = vi.spyOn(console, 'warn');
      const isConflictWarn = (c: unknown[]) => c.join(' ').includes('cascades take precedence');
      try {
        const view3d = new View3D({ width: SIZE, height: SIZE, shadowQuality: 'medium' });
        app.stage.addChild(view3d);

        const caster = new Mesh3D({
          geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
          material: new Material3D({ baseColor: 0x4a7c59, metallic: 0, roughness: 0.5 }),
          castShadow: true,
        });
        view3d.root.addChild(caster);

        const sun = new DirectionalLight({ intensity: 5, castShadow: true, shadow: { cascades: 2 } });
        sun.rotation.set((-45 * Math.PI) / 180, (30 * Math.PI) / 180, 0);
        view3d.root.addChild(sun);

        view3d.camera.position.set(0, 3, 6);
        view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

        app.render();
        expect(warnSpy.mock.calls.some(isConflictWarn)).toBe(false);

        // The state the types forbid, reached the way types can't see. Two frames in the
        // conflicted state; the warn is a page-global `warnOnce`, so the first backend in
        // this file logs it exactly once (not per frame) and the second finds it consumed.
        sun.shadow.bounds = Box.fromCenterSize({ x: 0, y: 0, z: 0 }, 10);
        app.render();
        app.render();
        expect(warnSpy.mock.calls.filter(isConflictWarn).length).toBe(preference === 'webgpu' ? 1 : 0);
      } finally {
        warnSpy.mockRestore();
        app.destroy();
      }
    });
  });
}
