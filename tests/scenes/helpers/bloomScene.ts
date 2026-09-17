import type { TestScene } from '@test-utils';

import { BloomEffect } from '~/extras/post-processing/effects/BloomEffect';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import type { PostEffect } from '~/post-processing/effects/PostEffect';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 200;

/**
 * Three emissive spheres over a dim floor, with a hot bloom first in `passes` so the glow reaches
 * past each silhouette onto the floor and the dark backdrop. The threshold sits below the
 * emissive spheres and above the lit floor, so only the spheres bloom.
 *
 * The View size (200px) is NOT a power of two and the pyramid's top level runs at
 * `resolution: 0.5`, so its five levels are pooled textures of five different sizes, each read
 * through its own clamp rect. A mismatch at any level shows as a glow offset from its sphere,
 * not a colour shift.
 * @param after - Effects to run after the bloom, so the same picture can be baselined mid-chain.
 * @returns The scene.
 */
export function bloomScene(after: PostEffect[] = []): TestScene {
  return {
    app: {
      width: 340,
      height: 260,
      backgroundColor: 0x10141a,
    },
    delay: 120,
    create: async (app) => {
      const view = new View3D({
        width: SIZE,
        height: SIZE,
        anchor: 0.5,
        toneMapping: 'none',
        environment: { skyColor: 0x334455, groundColor: 0x111111 },
        passes: [new BloomEffect({ threshold: 0.5, intensity: 3, radius: 0.7, resolution: 0.5 }), ...after],
      });
      view.camera.fov = 45;
      view.camera.position.set(0, 1.6, 5);
      view.camera.lookAt({ x: 0, y: 0.2, z: 0 });

      view.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 0.2 }));

      const glowing = [
        { x: -1.4, color: 0xff5533 },
        { x: 0, color: 0x66ff88 },
        { x: 1.4, color: 0x5599ff },
      ];
      for (const { x, color } of glowing) {
        const sphere = new Mesh3D({
          geometry: new SphereGeometry({ radius: 0.45 }),
          material: new Material3D({ baseColor: 0x202020, roughness: 0.6, emissive: { color, strength: 2 } }),
        });
        sphere.position.set(x, 0.2, 0);
        view.root.addChild(sphere);
      }

      const floor = new Mesh3D({
        geometry: new PlaneGeometry({ width: 8, height: 8 }),
        material: new Material3D({ baseColor: 0x55606c, roughness: 0.9 }),
      });
      floor.rotation.set(-Math.PI / 2, 0, 0);
      floor.position.set(0, -0.3, 0);
      view.root.addChild(floor);

      view.position.set(170, 130);
      app.stage.addChild(view);
    },
  };
}
