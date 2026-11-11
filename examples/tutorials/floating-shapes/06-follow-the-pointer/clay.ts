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
        // Rough, like clay, with a thin glossy coat on top
        roughness: 0.55,
        clearcoat: { factor: 0.4, roughness: 0.25 },
        // Lights each triangle as one flat face, for shapes with sharp edges
        flatShading,
      }),
  );
}

export function createClay(): Clay[] {
  const smooth = createMaterials(false);
  const faceted = createMaterials(true);

  // One of each primitive, all about the same size, with the materials that suit it
  return [
    {
      geometry: new TorusGeometry({ radius: 0.5, tube: 0.24, radialSegments: 24, tubularSegments: 64 }),
      materials: smooth,
    },
    { geometry: new CapsuleGeometry({ radius: 0.32, height: 1.4 }), materials: smooth },
    { geometry: new CubeGeometry({ width: 0.9, height: 0.9, depth: 0.9 }), materials: smooth },
    { geometry: new SphereGeometry({ radius: 0.6, widthSegments: 48, heightSegments: 32 }), materials: smooth },
    { geometry: new IcosahedronGeometry({ radius: 0.7 }), materials: faceted },
    // A cone with three sides is a pyramid
    { geometry: new ConeGeometry({ radius: 0.7, height: 1.1, radialSegments: 3 }), materials: faceted },
  ];
}
