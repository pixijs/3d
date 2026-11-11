import { Application, BlurFilter } from 'pixi.js';

import { addHeadline } from './headline';
import { followPointer } from './pointer';
import { addShapes } from './shapes';
import { addView } from './view';

(async () => {
  const app = new Application();

  // Initialize the application. preference: 'webgpu' picks WebGPU where the browser has it, and WebGL2 elsewhere.
  await app.init({
    preference: 'webgpu',
    resizeTo: window,
    antialias: true,
    background: 0xf3edff,
    resolution: Math.min(window.devicePixelRatio, 2),
    autoDensity: true,
  });

  document.body.appendChild(app.canvas);

  // A far view, added first so it draws behind. Its camera stands further back, so its shapes look
  // smaller and move less, and the blur puts them out of focus.
  const far = addView(app);
  const blur = new BlurFilter({ strength: 6 });

  // Repeat the pixels at the screen's edges into the blur, so the edges don't fade
  blur.repeatEdgePixels = true;
  far.filters = [blur];
  far.camera.position.z = 20;
  addShapes(app, far, 10, 'far');
  followPointer(app, far);

  // The near view draws over the far one, so it leaves out the sky
  const view3d = addView(app);

  view3d.background = null;
  addShapes(app, view3d, 14, 'floating-shapes');
  followPointer(app, view3d);

  // Added last, so the text draws over both views
  addHeadline(app);
})();
