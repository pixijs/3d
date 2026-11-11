import type { View3D } from '@pixi/3d';
import type { Application } from 'pixi.js';

// Half the booth's width and height, with a little room around it, the height of its middle, and
// how far its front stands out from the origin
const HALF_WIDTH = 4.9;
const HALF_HEIGHT = 3.5;
const MIDDLE = 3.2;
const FRONT = 2;

export function setupCamera(app: Application, view3d: View3D) {
  const { camera } = view3d;
  let distance = 0;
  let shake = 0;

  camera.fov = 45;

  // Stand back far enough to fit the front of the booth on screen: its height, and on a narrow
  // screen its width. slope is how far the view spreads up or down for each unit of distance.
  const fit = () => {
    const slope = Math.tan((camera.fov * Math.PI) / 360);
    const aspect = app.screen.width / app.screen.height;

    distance = FRONT + Math.max(HALF_HEIGHT / slope, HALF_WIDTH / (slope * aspect));
    camera.position.set(0, MIDDLE, distance);
  };

  fit();
  app.renderer.on('resize', fit);

  // While shaking, jolt the camera off its spot by up to half of `shake` in x and y, less every frame
  app.ticker.add((ticker) => {
    if (shake === 0) return;

    shake = Math.max(0, shake - ticker.deltaMS / 1000);
    camera.position.set((Math.random() - 0.5) * shake, MIDDLE + (Math.random() - 0.5) * shake, distance);
  });

  return {
    shake() {
      shake = 0.3;
    },
  };
}
