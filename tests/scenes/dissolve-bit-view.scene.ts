import type { TestScene } from '@test-utils';

import { dissolveBit } from '~/extras/materials/bits/dissolveBit';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import type { BaseMaterial3D } from '~/materials/BaseMaterial3D';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import type { View3DOptions } from '~/scene/View3D';
import { View3D } from '~/scene/View3D';

const VIEW_SIZE = 200;
const HOLE_SIZE_FOR_A_LARGE_HOLE_FACING_CAMERA = 0.35;

export const scene: TestScene = {
  app: { width: VIEW_SIZE * 2, height: VIEW_SIZE * 2, backgroundColor: 0x1a1a2e },
  delay: 120,
  create: async (app) => {
    const geometry = new SphereGeometry({ radius: 0.6, widthSegments: 32, heightSegments: 24 });
    const grey = () => new Material3D({ baseColor: 0x50555c, roughness: 0.5 });
    const warmEdgeMatchingTheSurfaceUnder: Record<
      string,
      { options: Partial<View3DOptions>; base: BaseMaterial3D; edge: number[] }
    > = {
      'exposure 0.5, which reads the edge as [0.8, 0.3, 0.05]': {
        options: { toneMapping: 'none', exposure: 0.5 },
        base: grey(),
        edge: [1.6, 0.6, 0.1],
      },
      'ACES, which rolls a hot edge off instead of clipping it': {
        options: { toneMapping: 'aces' },
        base: grey(),
        edge: [6, 2, 0.4],
      },
      'linear fog in the background colour, which dims the edge with the surface': {
        options: { toneMapping: 'none', fog: { type: 'linear', color: 0x1a1a2e, near: 0, far: 3 } },
        base: grey(),
        edge: [0.8, 0.3, 0.05],
      },
      'an unlit FlatMaterial in display space, which reads the edge as linear light, as dark as on a lit material': {
        options: { toneMapping: 'none' },
        base: new FlatMaterial({ baseColor: 0x50555c }),
        edge: [0.35, 0.1, 0],
      },
    };

    Object.values(warmEdgeMatchingTheSurfaceUnder).forEach(({ options, base, edge }, i) => {
      const view = new View3D({
        width: VIEW_SIZE,
        height: VIEW_SIZE,
        anchor: 0.5,
        environment: { skyColor: 0xffffff, groundColor: 0x223344 },
        ...options,
      });
      view.camera.fov = 40;
      view.camera.position.set(0, 0.25, 2.2);
      view.camera.lookAt({ x: 0, y: 0, z: 0 });

      view.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 0.25 }));
      const key = new DirectionalLight({ color: 0xffffff, intensity: 4 });
      key.position.set(3, 5, 4);
      key.lookAt({ x: 0, y: 0, z: 0 });
      view.root.addChild(key);

      const copy = base.clone({ extraBits: [dissolveBit] });

      copy.data.dissolve = 0.5;
      copy.data.dissolveEdgeColor = edge;
      copy.data.dissolveHoleSize = HOLE_SIZE_FOR_A_LARGE_HOLE_FACING_CAMERA;
      view.root.addChild(new Mesh3D({ geometry, material: copy }));

      view.position.set((i % 2) * VIEW_SIZE + VIEW_SIZE / 2, Math.floor(i / 2) * VIEW_SIZE + VIEW_SIZE / 2);
      app.stage.addChild(view);
    });
  },
};
