/**
 * The props: the white clay gathered under the spot's lamp and round the bulb
 *
 * The clay is white so every hue on it is a light's colour: blue is the bulb, orange the spot, lilac the ambient.
 */

import { Mesh3D } from '@pixi/3d';
import type { Container3D, PointData3D } from '@pixi/3d';

import { clayMaterial } from '../shared/theme/clay';
import { clayGeometry } from '../shared/theme/shapes';
import type { ClayShape } from '../shared/theme/shapes';

export interface ClayOptions {
  parent: Container3D;
  /** Where the spot's lamp hangs */
  lamp: PointData3D;
  /** The centre of the bulb's drift */
  bulb: PointData3D;
}

/**
 * Each shape's place on the floor, from the light it stands by. The cube and the capsule stand in the spot's pool
 * either side of its axis as the camera sees it, near enough to the axis that the gaps their shadows leave fall where
 * the pool is brightest, and pointing away from the sun's shadows. The octahedron and the sphere stand a step behind
 * the bulb on either side, so the faces it lights also face the camera.
 */
const PLACES: readonly { shape: ClayShape; by: 'lamp' | 'bulb'; x: number; z: number }[] = [
  { shape: 'cube', by: 'lamp', x: -0.65, z: 0.55 },
  { shape: 'capsule', by: 'lamp', x: 0.82, z: 0.38 },
  { shape: 'octahedron', by: 'bulb', x: -1.1, z: -0.2 },
  { shape: 'sphere', by: 'bulb', x: 1.2, z: -0.3 },
];

export function createClay({ parent, lamp, bulb }: ClayOptions): void {
  for (const { shape, by, x, z } of PLACES) {
    const geometry = clayGeometry(shape);
    const light = by === 'lamp' ? lamp : bulb;

    // Resting on the floor: the shape's lowest point at y 0.
    new Mesh3D({
      geometry,
      material: clayMaterial('white'),
      position: { x: light.x + x, y: -geometry.bounds3D.min.y, z: light.z + z },
      parent,
    });
  }
}
