import { DirectionalLight, Material3D, Mesh3D, SphereGeometry, View3D } from '@pixi/3d';
import { Application } from 'pixi.js';

(async () => {
  // Create a new application
  const app = new Application();

  // Initialize the application. preference: 'webgpu' picks WebGPU where the browser has it, and WebGL2 elsewhere.
  await app.init({
    preference: 'webgpu',
    resizeTo: window,
    antialias: true,
    background: 0x1d1a24,
    resolution: Math.min(window.devicePixelRatio, 2),
    autoDensity: true,
  });

  // Append the application canvas to the document body
  document.body.appendChild(app.canvas);

  /** -- INSERT CODE HERE -- */
})();
