import { DirectionalLight, View3D } from '@pixi/3d';
import type { Hemisphere } from '@pixi/3d';
import type { Application } from 'pixi.js';

// The colours of the sky behind the shapes: almost white above, violet below
const sky: Hemisphere = { skyColor: 0xfdf8ff, groundColor: 0x8f72ee, intensity: 1.4 };

export function addView(app: Application): View3D {
  // The same hemisphere draws the background and lights the scene, so the light on the shapes
  // matches the sky behind them
  const view3d = new View3D({ autoResize: true, background: sky, environment: sky });

  app.stage.addChild(view3d);

  // The camera starts at the origin looking along -Z. Move it back so the origin is in front of it.
  view3d.camera.position.set(0, 0, 10);

  // A sun above the scene, to the left and in front. A directional light shines along its -Z axis,
  // and lookAt turns that axis toward a point. castShadow lets the shapes shadow each other.
  const sun = new DirectionalLight({ intensity: 1.5, castShadow: true });

  sun.position.set(-4, 6, 8);
  view3d.root.addChild(sun);
  sun.lookAt({ x: 0, y: 0, z: 0 });

  return view3d;
}
