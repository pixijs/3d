import type { TestScene } from '@test-utils';

import { TintEffect } from '~/extras/post-processing/effects/TintEffect';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * The effects seam, two-slot chain shape: `passes: [red tint, green
 * tint]`. Tint 1 writes an intermediate pooled transient (mid-chain pass, no
 * blending); tint 2 samples it and presents. The result is the two multipliers
 * composed — a dark olive — visually distinct from either single tint, which
 * is what pins the ping-pong wiring: a chain that dropped a slot renders as
 * pure red or pure green instead.
 *
 * Same non-power-of-two sizing rationale as `effect-tint.scene.ts`; single
 * view per scene until the pre-existing WebGL multi-view erasure is fixed.
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
      passes: [new TintEffect({ tint: 0xff6666 }), new TintEffect({ tint: 0x66ff66 })],
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
