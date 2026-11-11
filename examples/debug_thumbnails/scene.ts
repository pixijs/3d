/**
 * The props: nine clay meshes in an arc for the asset shelf to picture, in two rows on a phone, and the knot's geometry
 *
 * Nothing here touches the thumbnail generator; `index.ts` does that.
 */

import { Container3D, Mesh3D, TorusKnotGeometry } from '@pixi/3d';
import type { Geometry3D } from '@pixi/3d';
import type { Rectangle } from 'pixi.js';

import { clayMaterial } from '../shared/theme/clay';
import { NARROW_BELOW } from '../shared/theme/overlay';
import type { ClayColor } from '../shared/theme/palette';
import { clayGeometry } from '../shared/theme/shapes';
import type { ClayShape } from '../shared/theme/shapes';

/**
 * The arc's meshes, left to right, each turned its own way about y so no two poses match. The pink and sky cubes share
 * one geometry. A face turned edge-on to the camera catches the clay's pale lilac sheen, so the pink cube turns both
 * its faces towards it, or that face reads as a second cube behind.
 */
const LINEUP: readonly { shape: ClayShape | 'knot'; color: ClayColor; yaw: number }[] = [
  { shape: 'cube', color: 'pink', yaw: 0.8 },
  { shape: 'capsule', color: 'palePink', yaw: 0.75 },
  { shape: 'sphere', color: 'purple', yaw: 1.2 },
  { shape: 'puck', color: 'lilac', yaw: 1.65 },
  { shape: 'cube', color: 'sky', yaw: 2.1 },
  { shape: 'pyramid', color: 'paleSky', yaw: 2.55 },
  { shape: 'octahedron', color: 'orange', yaw: 3 },
  { shape: 'torus', color: 'white', yaw: 3.45 },
  { shape: 'knot', color: 'pink', yaw: 3.9 },
];
/** The gap between neighbours, and how far the arc bows back towards its ends */
const SPACING = 1.25;
const BOW = 0.05;
/** The height each mesh's centre rests at, so the largest clears the floor */
const REST_Y = 0.6;
/**
 * A phone is too narrow for nine shapes in a row to read, so there the arc folds into two rows in the shelf's order,
 * five behind and four in front, this far apart, and scales up to span about the width the one row did
 */
const BACK_ROW = 5;
const ROW_GAP = 4.5;
const FOLDED_SCALE = 1.8;

/** The arc of clay meshes the shelf pictures */
export interface Lineup {
  /** Every mesh, left to right, each labelled with its shape's name */
  readonly meshes: readonly Mesh3D[];
  /** The last mesh, whose geometry the pane rebuilds */
  readonly knot: Mesh3D;
  /** Folds the arc into two rows when the screen narrows, and back when it widens */
  update(): void;
}

/** A torus knot a unit across, cut into `tubularSegments` × 24 quads, two triangles each */
export function knotGeometry(tubularSegments: number): Geometry3D {
  return new TorusKnotGeometry({ radius: 0.3, tube: 0.1, tubularSegments, radialSegments: 24 });
}

/** Builds the arc under `parent`, the knot cut into `tubularSegments`, folding it while `screen` is narrow */
export function createLineup(parent: Container3D, tubularSegments: number, screen: Rectangle): Lineup {
  const root = new Container3D({ label: 'lineup', parent });
  const meshes = LINEUP.map(
    ({ shape, color, yaw }) =>
      new Mesh3D({
        label: shape,
        // clayGeometry hands back one cached geometry per shape, so the two cubes draw the same one.
        geometry: shape === 'knot' ? knotGeometry(tubularSegments) : clayGeometry(shape),
        material: clayMaterial(color),
        position: { x: 0, y: REST_Y, z: 0 },
        // The knot stands up to face the camera.
        rotation: { x: shape === 'knot' ? Math.PI / 2 : 0, y: yaw, z: 0 },
        parent: root,
      }),
  );
  let folded = false;

  /** One arc, or on a narrow screen two rows, scaled up */
  function fold(): void {
    folded = screen.width < NARROW_BELOW;
    root.scale.set(folded ? FOLDED_SCALE : 1);
    for (let i = 0; i < meshes.length; i++) {
      const front = folded && i >= BACK_ROW;
      const count = folded ? (front ? meshes.length - BACK_ROW : BACK_ROW) : meshes.length;
      const offset = (front ? i - BACK_ROW : i) - (count - 1) / 2;

      meshes[i].x = offset * SPACING;
      meshes[i].z = folded ? (front ? ROW_GAP / 2 : -ROW_GAP / 2) : -offset * offset * BOW;
    }
  }

  fold();

  return {
    meshes,
    knot: meshes[meshes.length - 1],
    update() {
      if (folded !== screen.width < NARROW_BELOW) fold();
    },
  };
}
