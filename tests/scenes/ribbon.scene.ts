import type { TestScene } from '@test-utils';

import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { RibbonGeometry } from '~/geometry/RibbonGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Container3D } from '~/scene/Container3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const TURNS = 120;

export const scene: TestScene = {
  app: { backgroundColor: 0xf4f1ea },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    const helix: number[] = [];
    const widths: number[] = [];
    const colors = new Float32Array((TURNS + 1) * 4);
    for (let i = 0; i <= TURNS; i++) {
      const t = i / TURNS;
      helix.push(Math.cos(i * 0.2) * 0.8, t * 2.4, Math.sin(i * 0.2) * 0.8);
      widths.push(0.28 * Math.sin(t * Math.PI));
      colors.set([1, 0.13 + 0.6 * t, 0.4, 1], i * 4);
    }

    const tiltedSquashedParent = new Container3D({ parent: view3d.root });
    tiltedSquashedParent.position.set(-1.1, 0.25, 0);
    tiltedSquashedParent.rotation.z = 0.25;
    tiltedSquashedParent.scale.set(1, 0.8, 1.3);
    new Mesh3D({
      geometry: new RibbonGeometry({ points: helix, width: widths, colors }),
      material: new Material3D({ baseColor: 0xffffff, roughness: 0.5, vertexColors: true }),
      parent: tiltedSquashedParent,
    });

    const threePixelLines: number[] = [];
    for (let l = 0; l < 3; l++) {
      for (let i = 0; i <= 40; i++)
        threePixelLines.push(0.6 + l * 0.5 + Math.sin(i * 0.4) * 0.15, 0.3 + i * 0.03, 2 - i * 0.2);
    }
    new Mesh3D({
      geometry: new RibbonGeometry({
        points: threePixelLines,
        pointsPerLine: 41,
        width: [4, 8, 12].flatMap((w) => Array.from({ length: 41 }, () => w)),
        widthUnits: 'pixels',
      }),
      material: new Material3D({ baseColor: 0x6a41e2, roughness: 0.6 }),
      parent: view3d.root,
    });

    const floor = new Mesh3D({
      geometry: new PlaneGeometry({ width: 8, height: 8 }),
      material: new Material3D({ baseColor: 0xd9d4c7, roughness: 1 }),
      parent: view3d.root,
    });
    floor.rotation.x = -Math.PI / 2;

    const sun = new DirectionalLight({ intensity: 3, castShadow: true, parent: view3d.root });
    sun.position.set(2, 5, 3);
    sun.lookAt({ x: 0, y: 0, z: 0 });

    view3d.camera.position.set(0, 2.4, 5.5);
    view3d.camera.lookAt({ x: 0, y: 1.1, z: 0 });
  },
};
