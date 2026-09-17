import type { TestScene } from '@test-utils';
import { Graphics } from 'pixi.js';
import type { Application } from 'pixi.js';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * Two transmissive cubes in two {@link View3D} insets of DIFFERENT sizes,
 * composited in one frame over a shared 2D grid. Exercises the renderer-shared
 * transient pool: the views render sequentially and recycle pooled opaque
 * copies from different power-of-two buckets, and each view's CopyOpaque
 * re-copies before it samples — so neither glass shows stale content from the
 * other. A correct render shows the grid refracting through both cubes.
 */
function addGlassView(app: Application, size: number, cx: number, cy: number): void {
  const view3d = new View3D({ width: size, height: size, anchor: 0.5 });
  view3d.position.set(cx, cy);
  app.stage.addChild(view3d);

  view3d.camera.fov = 35;
  view3d.camera.position.set(2.2, 1.8, 3.2);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

  view3d.root.addChild(new AmbientLight({ color: 0xc8d8ff, intensity: 0.4 }));
  const keyLight = new DirectionalLight({ color: 0xfff4e0, intensity: 3 });
  keyLight.position.set(4, 5, 6);
  keyLight.lookAt({ x: 0, y: 0, z: 0 });
  view3d.root.addChild(keyLight);

  const cube = new Mesh3D({
    geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
    material: new Material3D({
      baseColor: 0xffffff,
      metallic: 0,
      roughness: 0.05,
      transmission: { factor: 1, thickness: 0.5 },
      ior: 1.5,
    }),
    castShadow: false,
    receiveShadow: false,
  });
  cube.rotation.set(-0.5, 0.7, 0.0);
  view3d.root.addChild(cube);
}

export const scene: TestScene = {
  app: {
    backgroundColor: 0x10202a,
    useBackBuffer: true,
  },
  delay: 120,
  create: async (app) => {
    const w = app.screen.width;
    const h = app.screen.height;

    const backdrop = new Graphics();
    const step = 16;
    for (let x = 0; x <= w; x += step) backdrop.moveTo(x, 0).lineTo(x, h);
    for (let y = 0; y <= h; y += step) backdrop.moveTo(0, y).lineTo(w, y);
    backdrop.stroke({ color: 0x3a7ca5, width: 1.5, alpha: 1 });
    app.stage.addChild(backdrop);

    // Different sizes → different power-of-two buckets (96→128, 150→256).
    addGlassView(app, 96, w * 0.3, h * 0.5);
    addGlassView(app, 150, w * 0.68, h * 0.5);
  },
};
