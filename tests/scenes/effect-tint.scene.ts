import type { TestScene } from '@test-utils';

import { TintEffect } from '~/extras/post-processing/effects/TintEffect';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * The effects seam, single-transform shape: `passes: [red tint]` derives
 * composite mode ON and elects the one transform as presenter — scene renders
 * into a pooled transient, the tint pass samples it and writes the screen
 * directly (no OutputPass blit). Compare against any untinted lit scene: same
 * geometry, red-multiplied colour.
 *
 * The View size (200px) is deliberately NOT a power of two: the scene
 * transient rounds up to the 256 pooled bucket, so the effect pass must map
 * its sampling UV through uViewportUVScale — a wrong mapping shows as a
 * shrunken/stretched inset, not a colour shift.
 *
 * One view per scene: multi-view WebGL currently erases all but the last view
 * (pre-existing engine bug, reproduced with stock views — tracked separately);
 * the chain shape lives in `effect-tint-chain.scene.ts`.
 */

const SIZE = 200; // physical viewport 200 → nextPow2 bucket 256 → ratio ~0.78

export const scene: TestScene = {
  app: {
    width: 340,
    height: 260,
    backgroundColor: 0x242c36,
  },
  delay: 120,
  // Resources are built in create() (not module scope) so the second renderer in
  // the webgl→webgpu run gets its own GPU objects rather than freed ones.
  create: async (app) => {
    const view = new View3D({
      width: SIZE,
      height: SIZE,
      anchor: 0.5,
      toneMapping: 'none',
      // Hemisphere fill shades the sphere without a shadow-casting light.
      environment: { skyColor: 0xffffff, groundColor: 0x223344 },
      passes: [new TintEffect({ tint: 0xff6666 })],
    });
    view.camera.fov = 45;
    view.camera.position.set(0, 1.4, 4);
    view.camera.lookAt({ x: 0, y: 0, z: 0 });

    view.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 0.35 }));

    const sphere = new Mesh3D({
      geometry: new SphereGeometry({ radius: 0.9 }),
      material: new Material3D({ baseColor: 0x77aaff, roughness: 0.35, metallic: 0 }),
    });
    view.root.addChild(sphere);

    const floor = new Mesh3D({
      geometry: new PlaneGeometry({ width: 6, height: 6 }),
      material: new Material3D({ baseColor: 0x8899aa, roughness: 0.9 }),
    });
    floor.rotation.set(-Math.PI / 2, 0, 0);
    floor.position.set(0, -0.95, 0);
    view.root.addChild(floor);

    view.position.set(170, 130);
    app.stage.addChild(view);
  },
};
