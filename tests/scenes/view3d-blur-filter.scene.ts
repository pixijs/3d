import type { TestScene } from '@test-utils';
import { BlurFilter, Container, Graphics } from 'pixi.js';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * A {@link View3D} wrapped in a 2D container that carries a {@link BlurFilter},
 * composited over a sharp 2D grid. Proves a 3D view feeds a stock Pixi 2D
 * filter like any other display object: the cube + its card panel are softened
 * by the blur, while the grid behind (outside the filtered container) stays
 * crisp — so the screenshot reads the filter boundary directly.
 *
 * Rotation is fixed and the blur strength is static, so the steady-state frame
 * is deterministic across runs and backends.
 */
export const scene: TestScene = {
  app: {
    backgroundColor: 0x10131c,
  },
  // Let the auto-started ticker settle past the first prime frame.
  delay: 120,
  create: async (app) => {
    const w = app.screen.width;
    const h = app.screen.height;

    // Sharp 2D grid backdrop — stays unfiltered, so the blur's edge is legible.
    const backdrop = new Graphics();
    const step = 24;
    for (let x = 0; x <= w; x += step) backdrop.moveTo(x, 0).lineTo(x, h);
    for (let y = 0; y <= h; y += step) backdrop.moveTo(0, y).lineTo(w, y);
    backdrop.stroke({ color: 0x2e6c8c, width: 2, alpha: 1 });
    app.stage.addChild(backdrop);

    // Filtered container: a card panel + the View3D both pass through the blur.
    const card = new Container();
    card.position.set(w / 2, h / 2);
    card.filters = [new BlurFilter({ strength: 8, quality: 4 })];
    app.stage.addChild(card);

    const panel = new Graphics()
      .roundRect(-80, -80, 160, 160, 16)
      .fill({ color: 0x161a26, alpha: 1 })
      .stroke({ color: 0x7aa2ff, width: 2, alpha: 0.8 });
    card.addChild(panel);

    const view3d = new View3D({ width: 150, height: 150, anchor: 0.5 });
    card.addChild(view3d);

    view3d.camera.fov = 35;
    view3d.camera.position.set(2.2, 1.8, 3.2);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

    view3d.root.addChild(new AmbientLight({ color: 0xc8d8ff, intensity: 0.35 }));
    const keyLight = new DirectionalLight({ color: 0xfff4e0, intensity: 4 });
    keyLight.position.set(4, 5, 6);
    keyLight.lookAt({ x: 0, y: 0, z: 0 });
    view3d.root.addChild(keyLight);

    const cube = new Mesh3D({
      geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
      material: new Material3D({ baseColor: 0xff7733, metallic: 0.1, roughness: 0.4 }),
      castShadow: false,
      receiveShadow: false,
    });
    cube.rotation.set(-0.5, 0.7, 0.0);
    view3d.root.addChild(cube);
  },
};
