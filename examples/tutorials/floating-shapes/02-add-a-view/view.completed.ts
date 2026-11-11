import { FlatMaterial, Mesh3D, SphereGeometry, View3D } from '@pixi/3d';
import type { Hemisphere } from '@pixi/3d';
import type { Application } from 'pixi.js';

// The colours of the sky behind the shapes: almost white above, violet below
const sky: Hemisphere = { skyColor: 0xfdf8ff, groundColor: 0x8f72ee, intensity: 1.4 };

export function addView(app: Application) {
  // A View3D draws a 3D scene inside the 2D stage. autoResize keeps it the size of the screen.
  const view3d = new View3D({ autoResize: true, background: sky });

  app.stage.addChild(view3d);

  // The camera starts at the origin looking along -Z. Move it back so the origin is in front of it.
  view3d.camera.position.set(0, 0, 10);

  // A test shape at the origin. FlatMaterial ignores light, so it shows as flat colour for now.
  const ball = new Mesh3D({
    geometry: new SphereGeometry({ radius: 1.5 }),
    material: new FlatMaterial({ baseColor: 0xe91e63 }),
  });

  view3d.root.addChild(ball);
}
