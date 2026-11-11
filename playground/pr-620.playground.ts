import { CubeGeometry, DirectionalLight, Material3D, Mesh3D, PlaneGeometry, View3D } from '@pixi/3d';
import { Application } from 'pixi.js';

import { rendererPreference } from './src/getPreference';

const COLUMNS = 15;
const SPACING = 1.2;

/**
 * WebGL culling with partial index uploads (PR #620). View with `?renderer=webgl`.
 *
 * The camera orbits, so cubes leave and enter the view. A random cube toggles `visible` every half
 * second. At 2 s, 100 more cubes arrive and grow the index texture past 256. Apart from the toggled
 * cubes, no cube should vanish, flicker or swap places, and only visible cubes should cast shadows.
 */
export default async function () {
  const app = new Application();

  await app.init({ resizeTo: window, preference: rendererPreference, backgroundColor: 0x1d1d22 });
  document.body.appendChild(app.canvas);

  const view3d = new View3D({ autoResize: true, cull: 'gpu' });
  app.stage.addChild(view3d);

  const ground = new Mesh3D({
    geometry: new PlaneGeometry({ width: 40, height: 40 }),
    material: new Material3D({ baseColor: 0x8a8f99, roughness: 0.9 }),
  });
  ground.rotation.set(-Math.PI / 2, 0, 0);
  view3d.root.addChild(ground);

  const geometry = new CubeGeometry({ width: 0.6, height: 0.6, depth: 0.6 });
  const material = new Material3D({ baseColor: 0xe07a4a, roughness: 0.5 });
  const cubes: Mesh3D[] = [];

  const addCubes = (count: number) => {
    for (let i = 0; i < count; i++) {
      const n = cubes.length;
      const cube = new Mesh3D({ geometry, material });
      cube.position.set(((n % COLUMNS) - (COLUMNS - 1) / 2) * SPACING, 0.3, (Math.floor(n / COLUMNS) - 9.5) * SPACING);
      view3d.root.addChild(cube);
      cubes.push(cube);
    }
  };

  addCubes(200);

  const sun = new DirectionalLight({ intensity: 4, castShadow: true, shadow: { cascades: 3, maxDistance: 30 } });
  sun.rotation.set(-0.9, 0.5, 0);
  view3d.root.addChild(sun);

  let elapsed = 0;
  let nextToggle = 0.5;
  let grown = false;

  app.ticker.add((ticker) => {
    elapsed += ticker.deltaMS / 1000;

    const angle = elapsed * 0.3;
    view3d.camera.position.set(Math.cos(angle) * 10, 5, Math.sin(angle) * 10);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

    if (!grown && elapsed > 2) {
      grown = true;
      addCubes(100);
    }

    if (elapsed > nextToggle) {
      nextToggle += 0.5;
      const cube = cubes[Math.floor(Math.random() * cubes.length)];
      cube.visible = !cube.visible;
    }
  });
}
