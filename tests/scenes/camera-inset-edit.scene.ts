import type { TestScene } from '@test-utils';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';

import { cameraInsetScene } from './helpers/cameraInsetScene';

export const scene: TestScene = cameraInsetScene({
  edit: (view3d, wall) => {
    const nearWall = new Mesh3D({ geometry: wall.geometry, material: wall.material });
    nearWall.position.set(0, 0.55, 4.5);
    view3d.root.addChild(nearWall);

    const block = new Mesh3D({
      geometry: new CubeGeometry({ width: 2, height: 1.4, depth: 2 }),
      material: new Material3D({ baseColor: 0xff2bd6, metallic: 0, roughness: 0.6 }),
    });
    block.position.set(1.5, 0.7, 2.5);
    view3d.root.addChild(block);
  },
});
