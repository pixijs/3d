import { DirectionalLight, Model3D, View3D } from '@pixi/3d';
import type { Scene3DSource } from '@pixi/3d';
import { OrbitCamera } from '@pixi/3d/extras';
import { Application, Assets } from 'pixi.js';
import type { CubeTexture } from 'pixi.js';

import { addButtons } from './buttons';
import { createClips } from './clips';
import { addFloor } from './floor';
import { addHotspot } from './hotspot';

// The Venice Sunset sky by Greg Zaal, Poly Haven, CC0, as six cube faces
const SKY_URL = 'https://pixijs.com/assets/3d/venice-sunset/venice-sunset.cubemap';

// Model: Fox by PixelMannen (CC0), rigged and animated by tomkranis (CC BY 4.0), converted to glTF by
// AsoboStudio and scurest (CC BY 4.0), https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox
const FOX_URL =
  'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@edc7c9e67c639d230715049ee31f9a96a6babbbe/Models/Fox/glTF-Binary/Fox.glb';

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

  // Six photos of a real place, one for each side of a cube around the scene
  const sky = await Assets.load<CubeTexture>(SKY_URL);

  // A view the size of the screen. The sky lights the scene and shows behind it.
  const view3d = new View3D({ autoResize: true, environment: sky, background: sky });

  app.stage.addChild(view3d);

  // A sun from the upper right
  const sun = new DirectionalLight({ intensity: 2 });

  sun.position.set(1, 1, 0.4);
  view3d.root.addChild(sun);
  sun.lookAt({ x: 0, y: 0, z: 0 });

  // Build the fox from the file, and scale it to 1 unit tall, whatever size the file made it
  const source = await Assets.load<Scene3DSource>(FOX_URL);
  const fox = new Model3D(source);

  fox.scale.set(1 / fox.height);
  view3d.root.addChild(fox);

  // Orbit around the fox: drag to turn, scroll or pinch to zoom
  view3d.camera.position.set(1.4, 1.1, 2.1);
  const orbit = new OrbitCamera({
    view: view3d,
    target: { x: 0, y: 0.5, z: 0 },
    enableDamping: true,
    enablePan: false,
    minDistance: 1.5,
    maxDistance: 6,
    maxPolarAngle: Math.PI / 2 - 0.1,
    autoRotate: true,
    autoRotateSpeed: 0.5,
  });

  // Step back on a narrow screen, so the fox fits across it
  if (app.screen.width < app.screen.height) orbit.zoom(0.6);

  // Crossfade the fox's animations
  const clips = createClips(app, fox.player!);

  // 2D buttons to switch between them
  addButtons(app, clips);

  // A label pinned to the fox's head
  addHotspot(app, view3d, fox, clips);

  // A stand for the fox, to catch its shadow
  addFloor(view3d);
})();
