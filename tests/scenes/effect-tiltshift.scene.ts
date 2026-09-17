import type { TestScene } from '@test-utils';

import { TiltShiftEffect } from '~/extras/post-processing/effects/TiltShiftEffect';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * Tilt-shift alone — the mip-copy `build()` shape: the effect blits the chain
 * input into a private mip-chained transient, GenerateMips fills the levels,
 * and the bokeh pass gathers LOD taps against the scene-depth transient while
 * presenting (single effect = elected presenter).
 *
 * The scene is a depth staircase: a line of saturated boxes receding from the
 * camera with the focal band pinned on the middle one — the near and far
 * boxes must smear while the middle stays crisp. A wrong depth convention,
 * missing mips, or a dropped copy all break this image grossly.
 *
 * The tall focal-depth pillar rises past the horizon so its top edge sits
 * against the empty (transparent) background — pinning the occlusion-weighted
 * gather: without it, the full-blur sky pixels average the pillar's colour
 * and the sharp silhouette smears into the backdrop.
 */

const SIZE = 200;

export const scene: TestScene = {
  app: {
    width: 340,
    height: 260,
    backgroundColor: 0x242c36,
  },
  delay: 120,
  create: async (app) => {
    const view = new View3D({
      width: SIZE,
      height: SIZE,
      anchor: 0.5,
      toneMapping: 'none',
      environment: { skyColor: 0xffffff, groundColor: 0x445566 },
      passes: [new TiltShiftEffect({ focalDepth: 7.3, focalNear: 0.6, focalFar: 2.2, maxBlur: 10 })],
    });
    view.camera.fov = 35;
    view.camera.position.set(0, 2.5, 7);
    view.camera.lookAt({ x: 0, y: 0.5, z: 0 });

    view.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 0.6 }));

    const colors = [0xe05252, 0xe0a052, 0x52c06a, 0x5290e0, 0x9a52e0, 0xe052b8];
    for (let i = 0; i < colors.length; i++) {
      const box = new Mesh3D({
        geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
        material: new Material3D({ baseColor: colors[i], roughness: 0.85, metallic: 0 }),
      });
      // Staggered x keeps every box visible down the line.
      box.position.set((i % 2 === 0 ? -0.7 : 0.7) * (1 + i * 0.12), 0.5, 3 - i * 1.6);
      view.root.addChild(box);
    }

    const pillar = new Mesh3D({
      geometry: new CubeGeometry({ width: 0.5, height: 4.5, depth: 0.5 }),
      material: new Material3D({ baseColor: 0x37b8a8, roughness: 0.85, metallic: 0 }),
    });
    pillar.position.set(1.6, 2.25, 0.2);
    view.root.addChild(pillar);

    const floor = new Mesh3D({
      geometry: new PlaneGeometry({ width: 30, height: 30 }),
      material: new Material3D({ baseColor: 0x9aa6b5, roughness: 0.95 }),
    });
    floor.rotation.set(-Math.PI / 2, 0, 0);
    view.root.addChild(floor);

    view.position.set(170, 130);
    app.stage.addChild(view);
  },
};
