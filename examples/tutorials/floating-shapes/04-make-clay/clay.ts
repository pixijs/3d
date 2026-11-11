import {
  CapsuleGeometry,
  ConeGeometry,
  CubeGeometry,
  IcosahedronGeometry,
  Material3D,
  SphereGeometry,
  TorusGeometry,
} from '@pixi/3d';
import type { Geometry3D } from '@pixi/3d';

// A geometry, and the materials it can be drawn in
interface Clay {
  geometry: Geometry3D;
  materials: Material3D[];
}

// Pink, rose, violet and sky blue
const colors = [0xe91e63, 0xf06695, 0x8b5cf6, 0x38bdf8];

// One material for each colour
function createMaterials(flatShading: boolean) {
  return colors.map(
    (color) =>
      new Material3D({
        baseColor: color,
        /** -- INSERT CODE HERE -- */
      }),
  );
}

export function createClay(): Clay[] {
  const smooth = createMaterials(false);
  const faceted = createMaterials(true);

  return [/** -- INSERT CODE HERE -- */];
}
