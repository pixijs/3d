import { CylinderGeometry, Material3D, Mesh3D } from '@pixi/3d';
import type { View3D } from '@pixi/3d';

export function addFloor(view3d: View3D) {
  // A low, round stand, wider than the fox is long
  const stand = new Mesh3D({
    geometry: new CylinderGeometry({ radiusTop: 1.15, radiusBottom: 1.2, height: 0.08, radialSegments: 96 }),
    material: new Material3D({ baseColor: 0xbdb2a6, roughness: 0.6 }),
    // It only catches the fox's shadow, so it casts none
    castShadow: false,
  });

  // A cylinder is centred on its middle: lower it by half its height to put its top at the fox's feet
  stand.position.y = -0.04;
  view3d.root.addChild(stand);
}
