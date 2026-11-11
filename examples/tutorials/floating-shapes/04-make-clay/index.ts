import { Mesh3D } from '@pixi/3d';
import { Application } from 'pixi.js';

import { createClay } from './clay';
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

  const view3d = addView(app);

  // Line up one of each shape in two rows, taking turns through the colours
  createClay().forEach(({ geometry, materials }, i) => {
    const mesh = new Mesh3D({ geometry, material: materials[i % materials.length] });

    mesh.position.set(((i % 3) - 1) * 1.8, i < 3 ? 1 : -1, 0);
    mesh.rotation.set(0.4, 0.6, 0);
    view3d.root.addChild(mesh);
  });
})();
