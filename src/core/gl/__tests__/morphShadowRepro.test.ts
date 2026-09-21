import { getApp, readCanvasPixels } from '@test-utils';
import { describe, expect, it } from 'vitest';

import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * A morphed mesh lit by a shadow-casting light must render, not fail. The shadow
 * pass compiles a depth shader per caster that composes the morph bit, which
 * reads `vid` + the morph/geometry storage — so the shadow vertex entry has to
 * declare `vid` and the shadow group has to bind those stores. When it didn't,
 * the WGSL failed to compile ("unresolved value 'vid'") and the morphed mesh
 * rendered dark/magenta. This guards that a morphed shadow caster stays lit.
 * ({@link morphShadowDeform} covers that the shadow actually tracks the morph.)
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

    // A shadow-casting light is what forces the shadow pass to compile a shader
    // for the morphed caster.
    const key = new DirectionalLight({ color: 0xffffff, intensity: 6, castShadow: true });
    key.rotation.set(-0.6, 0.4, 0);
    view3d.root.addChild(key);

    // A camera-filling green morph triangle (castShadow defaults true).
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
    expect([r, g, b]).not.toEqual([255, 0, 255]); // not the magenta shader-fail
    expect(g).toBeGreaterThan(20); // lit surface, not shadowed-to-black
  });

  it('WebGPU: lit base-pose shadow, not a failed pipeline', async () => {
    const [, g] = await run('webgpu');
    expect(g).toBeGreaterThan(20); // not the black invalid-pipeline result
  });
});
