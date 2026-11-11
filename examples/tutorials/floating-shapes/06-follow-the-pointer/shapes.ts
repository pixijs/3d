import { Container3D, Mesh3D, seededRandom } from '@pixi/3d';
import type { View3D } from '@pixi/3d';
import type { Application } from 'pixi.js';

import { createClay } from './clay';

export function addShapes(app: Application, view3d: View3D, count: number, seed: string) {
  const clay = createClay();

  // The same seed gives the same numbers, so the shapes land in the same places on every run
  const random = seededRandom(seed);

  const floats = Array.from({ length: count }, (_, i) => {
    const { geometry, materials } = clay[i % clay.length];
    const mesh = new Mesh3D({ geometry, material: materials[i % materials.length] });

    // Start each shape at a random tilt
    mesh.rotation.set(random() * Math.PI * 2, random() * Math.PI * 2, 0);

    // The float carries the shape around; the mesh inside it spins
    const float = new Container3D();

    float.addChild(mesh);
    view3d.root.addChild(float);

    // Spread the shapes around a ring that leaves the middle of the screen clear. x and y are
    // fractions of what the camera sees, so the ring fits a phone as well as a wide screen.
    const angle = (i / count) * Math.PI * 2 + random() * 0.3;
    const reach = 0.6 + random() * 0.35;

    return {
      float,
      mesh,
      x: Math.cos(angle) * reach,
      y: Math.sin(angle) * reach,
      z: (i % 2) * -1.5 + random() * 0.5,
      phase: random() * Math.PI * 2,
      spin: 0.2 + random() * 0.4,
    };
  });

  let time = 0;

  app.ticker.add((ticker) => {
    const seconds = ticker.deltaMS / 1000;

    time += seconds;

    // Half the height and half the width that the camera sees at the middle of the scene
    const { camera } = view3d;
    const halfHeight = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
    const halfWidth = halfHeight * (app.screen.width / app.screen.height);

    // A narrow screen has less room, so the shapes shrink there
    const size = Math.min(1, halfWidth / 4);

    for (const { float, mesh, x, y, z, phase, spin } of floats) {
      float.position.set(x * halfWidth, y * halfHeight + Math.sin(time + phase) * 0.25, z);
      float.scale = size;
      mesh.rotation.x += spin * seconds;
      mesh.rotation.y += spin * 0.7 * seconds;
    }
  });
}
