import type { TestScene } from '@test-utils';
import { Graphics } from 'pixi.js';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * Worst-case stress for power-of-two-pool mip bleed.
 *
 * The inset is 130px in a 256px canvas, so the opaque copy rounds to the 256
 * power-of-two bucket and the viewport content occupies only ~half of it
 * (`130/256 ≈ 0.51`) — the rest is zero-initialised padding. A *rough*, flat,
 * front-facing glass slab (`roughness 0.7`) fills the view, so its
 * high-transmission samples reach right up to the content/padding boundary —
 * and there the wide high-mip footprint averages the black padding into the
 * result (a dark frame around the slab) if the mip chain weren't handled. (A
 * centred sphere/cube does NOT expose this: its boundary-reaching samples are
 * at the grazing rim where Fresnel kills transmission, masking the bleed —
 * hence the flat slab.) The LOD-aware clamp in `transmissionBit` keeps the
 * blurred tap inside the content, so the reference shows clean frosted
 * refraction with no dark frame; a regression that drops the clamp pulls the
 * padding in and diffs here.
 *
 * The bucket boundary (content ~0.5) is the maximum padding fraction achievable
 * — `nextPow2` at most doubles, so content/texture is always in `[0.5, 1]`.
 */
export const scene: TestScene = {
  app: {
    backgroundColor: 0x05080c,
    useBackBuffer: true,
  },
  delay: 120,
  create: async (app) => {
    const w = app.screen.width;
    const h = app.screen.height;

    // High-contrast fine grid so any padding (black) bled into the refraction
    // shows up as a visible dark smear.
    const backdrop = new Graphics();
    const step = 12;
    for (let x = 0; x <= w; x += step) backdrop.moveTo(x, 0).lineTo(x, h);
    for (let y = 0; y <= h; y += step) backdrop.moveTo(0, y).lineTo(w, y);
    backdrop.stroke({ color: 0xffffff, width: 1.5, alpha: 1 });
    app.stage.addChild(backdrop);

    // 130px inset -> 256 power-of-two bucket -> content fills ~51% of it.
    const view3d = new View3D({ width: 130, height: 130, anchor: 0.5 });
    view3d.position.set(w * 0.5, h * 0.5);
    app.stage.addChild(view3d);

    view3d.camera.fov = 35;
    view3d.camera.position.set(0, 0, 3.4);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

    view3d.root.addChild(new AmbientLight({ color: 0xc8d8ff, intensity: 0.4 }));
    const keyLight = new DirectionalLight({ color: 0xfff4e0, intensity: 3 });
    keyLight.position.set(4, 5, 6);
    keyLight.lookAt({ x: 0, y: 0, z: 0 });
    view3d.root.addChild(keyLight);

    // Flat, front-facing rough-glass slab overfilling the view: every fragment
    // is front-facing (high transmission) and the slab's edges land at the
    // content/padding boundary, so the high-mip blur footprint there reaches
    // into the padding.
    const slab = new Mesh3D({
      geometry: new CubeGeometry({ width: 2.8, height: 2.8, depth: 0.12 }),
      material: new Material3D({
        baseColor: 0xffffff,
        metallic: 0,
        roughness: 0.7,
        transmission: { factor: 1, thickness: 0.5 },
        ior: 1.5,
      }),
      castShadow: false,
      receiveShadow: false,
    });
    view3d.root.addChild(slab);
  },
};
