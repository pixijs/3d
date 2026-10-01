import { getApp, readCanvasPixels } from '@test-utils';
import { describe, expect, it } from 'vitest';

import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * Renders a camera-filling morphed triangle under a shadow-casting light and reads the centre pixel
 *
 * The light makes the shadow pass compile a depth shader for the morphed caster, and that shader
 * reads the vertex index and the morph and geometry stores, so it has to declare and bind them.
 * `morphShadowDeform.test.ts` checks that the shadow follows the morph.
 * @param preference - The backend to render with
 */
async function run(preference: 'webgl' | 'webgpu'): Promise<[number, number, number]> {
  const app = await getApp({
    id: `morph-shadow-${preference}`,
    appOptions: { preference, width: 64, height: 64, backgroundColor: 0x101014 },
  });
  try {
    const view3d = new View3D({ width: 64, height: 64, shadowQuality: 'medium' });
    app.stage.addChild(view3d);
    view3d.camera.position.set(0, 0, 2.6);

    const key = new DirectionalLight({ color: 0xffffff, intensity: 6, castShadow: true });
    key.rotation.set(-0.6, 0.4, 0);
    view3d.root.addChild(key);

    const mesh = new Mesh3D({
      geometry: new Geometry3D({
        positions: new Float32Array([-2, -2, 0, 2, -2, 0, 0, 2.5, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
        morphTargets: [{ positions: new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0]) }],
      }),
      material: new Material3D({ baseColor: 0x4a7c59, metallic: 0, roughness: 0.5, doubleSided: true }),
    });
    view3d.root.addChild(mesh);

    app.render();
    app.render();

    const { width, height } = app.canvas;
    const centre = readCanvasPixels(app.canvas, width / 2, height / 2, 1, 1);
    return [centre[0], centre[1], centre[2]];
  } finally {
    app.destroy();
  }
}

describe('morphed shadow caster', () => {
  it('WebGL: lit base-pose shadow, not a failed shader', async () => {
    const [r, g, b] = await run('webgl');
    expect([r, g, b], 'not the magenta of a failed shader').not.toEqual([255, 0, 255]);
    expect(g, 'a lit surface, not shadowed to black').toBeGreaterThan(20);
  });

  it('WebGPU: lit base-pose shadow, not a failed pipeline', async () => {
    const [, g] = await run('webgpu');
    expect(g, 'not the black of an invalid pipeline').toBeGreaterThan(20);
  });
});
