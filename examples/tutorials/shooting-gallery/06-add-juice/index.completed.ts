import { View3D } from '@pixi/3d';
import { BloomEffect } from '@pixi/3d/extras';
import { Application } from 'pixi.js';

import { buildBooth } from './booth';
import { setupCamera } from './camera';
import { createConfetti } from './confetti';
import { createScore } from './score';
import { createTargets } from './targets';

(async () => {
  // Create a new application
  const app = new Application();

  // Initialize the application. preference: 'webgpu' picks WebGPU where the browser has it, and WebGL2 elsewhere.
  await app.init({
    preference: 'webgpu',
    resizeTo: window,
    antialias: true,
    background: 0x0d0b14,
    resolution: Math.min(window.devicePixelRatio, 2),
    autoDensity: true,
  });

  // Append the application canvas to the document body
  document.body.appendChild(app.canvas);

  // A dim night sky lights the scene, so the spotlights stand out, and bloom makes what's
  // brighter than white glow
  const view3d = new View3D({
    autoResize: true,
    environment: { skyColor: 0x3d3a78, groundColor: 0x120e1c, intensity: 1 },
    passes: [new BloomEffect()],
  });

  view3d.cursor = 'crosshair';
  app.stage.addChild(view3d);

  // A camera that fits the booth to the screen, and the booth itself
  const camera = setupCamera(app, view3d);

  buildBooth(view3d);

  // Confetti and the score, for the targets to set off when they're hit
  const confetti = createConfetti(view3d);
  const score = createScore(app, view3d);

  createTargets(app, view3d, (point) => {
    confetti.burst(point);
    score.add(1);
    camera.shake();
  });
})();
