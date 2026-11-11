import { DirectionalLight, Material3D, Mesh3D, SphereGeometry, View3D } from '@pixi/3d';
import { Application, Assets } from 'pixi.js';
import type { CubeTexture } from 'pixi.js';

// The Venice Sunset sky by Greg Zaal, Poly Haven, CC0, as six cube faces
const SKY_URL = 'https://pixijs.com/assets/3d/venice-sunset/venice-sunset.cubemap';

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
  view3d.camera.position.set(0, 0, 5);

  // Two test balls that share one sphere geometry: a polished metal one and a matte pink one
  const geometry = new SphereGeometry({ radius: 0.55 });
  const mirror = new Mesh3D({
    geometry,
    material: new Material3D({ baseColor: 0xffffff, metallic: 1, roughness: 0.05 }),
  });
  const matte = new Mesh3D({ geometry, material: new Material3D({ baseColor: 0xf06695, roughness: 0.6 }) });

  mirror.x = -0.65;
  matte.x = 0.65;
  view3d.root.addChild(mirror, matte);

  // A sun from the upper right
  const sun = new DirectionalLight({ intensity: 2 });

  sun.position.set(1, 1, 0.4);
  view3d.root.addChild(sun);
  sun.lookAt({ x: 0, y: 0, z: 0 });
})();
