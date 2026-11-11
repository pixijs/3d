import { Application } from 'pixi.js';

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

  addView(app);
})();
