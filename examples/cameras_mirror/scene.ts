/** The props: the clay stand the glass lies on */

import { Mesh3D } from '@pixi/3d';
import type { Container3D } from '@pixi/3d';

import { clayMaterial } from '../shared/theme/clay';
import { roundedBox } from '../shared/theme/shapes';

/** How far the stand reaches past the glass on every side, so it frames it */
const RIM = 0.15;

export interface StandOptions {
  parent: Container3D;
  /** The glass's size and the z of its centre */
  glass: { width: number; depth: number; z: number };
  /** The glass's height, which the stand's top sits a hair under, so the two never fight */
  height: number;
}

/** A low lilac clay slab under the glass */
export function createStand({ parent, glass, height }: StandOptions): Mesh3D {
  const top = height - 0.004;

  return new Mesh3D({
    geometry: roundedBox(glass.width + RIM * 2, top, glass.depth + RIM * 2, 0.12),
    material: clayMaterial('lilac'),
    position: { x: 0, y: top / 2, z: glass.z },
    parent,
  });
}
