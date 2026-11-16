/**
 * The props: a clay heightfield terrain floating over the floor, a clay rock sunk into it, and the ball the reader
 * drags over them
 *
 * They're ordinary meshes with ordinary geometry; `index.ts` makes every query on them.
 */

import { Geometry3D, Mesh3D, Plane } from '@pixi/3d';
import type { Container3D, Vector3, View3D } from '@pixi/3d';

import { clayMaterial } from '../shared/theme/clay';
import { clayGeometry } from '../shared/theme/shapes';

/** Cells along each side: 40 × 40 cells is 3,200 triangles, enough that testing every one per query would show */
const CELLS = 40;
const SIDE = CELLS + 1;
/** The patch's side in scene units */
export const TERRAIN_SIZE = 6;
/** How high the patch floats: clear of the floor in its hollows, with its shadow showing its shape below */
export const TERRAIN_HEIGHT = 0.9;
/** The clay sphere's radius at scale 1 */
const CLAY_SPHERE_RADIUS = 0.45;
const UP = { x: 0, y: 1, z: 0 };
/** The step that measures the slope for the normals */
const SLOPE_STEP = 0.01;

/** The ground at (x, z) in the terrain's own space: two broad hills, a hollow and a low ripple */
function heightAt(x: number, z: number): number {
  return 0.45 * Math.sin(0.7 * x + 0.6) * Math.cos(0.6 * z - 0.3) + 0.12 * Math.sin(1.9 * x - 1.4 * z);
}

/** A static heightfield geometry: positions, slope normals and two triangles a cell */
function terrainGeometry(): Geometry3D {
  const positions = new Float32Array(SIDE * SIDE * 3);
  const normals = new Float32Array(SIDE * SIDE * 3);
  const indices = new Uint16Array(CELLS * CELLS * 6);

  for (let row = 0; row < SIDE; row++) {
    for (let column = 0; column < SIDE; column++) {
      const i = (row * SIDE + column) * 3;
      const x = (column / CELLS - 0.5) * TERRAIN_SIZE;
      const z = (row / CELLS - 0.5) * TERRAIN_SIZE;
      // A surface y = h(x, z) faces (-dh/dx, 1, -dh/dz), scaled to length 1.
      const dx = (heightAt(x + SLOPE_STEP, z) - heightAt(x - SLOPE_STEP, z)) / (2 * SLOPE_STEP);
      const dz = (heightAt(x, z + SLOPE_STEP) - heightAt(x, z - SLOPE_STEP)) / (2 * SLOPE_STEP);
      const length = Math.hypot(dx, 1, dz);

      positions.set([x, heightAt(x, z), z], i);
      normals.set([-dx / length, 1 / length, -dz / length], i);
    }
  }
  for (let row = 0; row < CELLS; row++) {
    for (let column = 0; column < CELLS; column++) {
      const a = row * SIDE + column;
      const b = a + SIDE;

      // Counter-clockwise seen from above, so each triangle's front faces up.
      indices.set([a, b, a + 1, a + 1, b, b + 1], (row * CELLS + column) * 6);
    }
  }

  return new Geometry3D({ positions, normals, indices });
}

/** The terrain, lifted to `TERRAIN_HEIGHT`, so its local space is not the world's */
export function createTerrain(parent: Container3D): Mesh3D {
  return new Mesh3D({
    geometry: terrainGeometry(),
    material: clayMaterial('paleSky'),
    position: { x: 0, y: TERRAIN_HEIGHT, z: 0 },
    parent,
  });
}

/**
 * A clay octahedron, scaled up, tipped over and turned, sunk into the terrain's hollow behind its middle. The scale
 * and the turn are why a query on it needs the point moved into its own space first.
 */
export function createRock(parent: Container3D): Mesh3D {
  const x = 1;
  const z = -0.6;

  return new Mesh3D({
    geometry: clayGeometry('octahedron'),
    material: clayMaterial('purple'),
    position: { x, y: TERRAIN_HEIGHT + heightAt(x, z) + 0.45, z },
    rotation: { x: 0.5, y: 0.7, z: 0.3 },
    scale: 1.7,
    parent,
  });
}

/** The ball, in the open in front of the rock; it takes pointer events so the reader can drag it */
export function createBall(parent: Container3D): Mesh3D {
  return new Mesh3D({
    geometry: clayGeometry('sphere'),
    material: clayMaterial('orange'),
    position: { x: -0.2, y: 0, z: 0.3 },
    eventMode: 'static',
    cursor: 'grab',
    parent,
  });
}

export function setBallRadius(ball: Mesh3D, radius: number): void {
  ball.scale.set(radius / CLAY_SPHERE_RADIUS);
}

/**
 * Lets the reader drag the ball. A press lays a level plane through its centre, and each move writes the pointer's
 * point on that plane into `target`; the ball itself moves only where `index.ts` moves it.
 */
export function dragBall(view3d: View3D, ball: Mesh3D, target: Vector3): void {
  const plane = new Plane();
  let dragging = false;

  function drop(): void {
    dragging = false;
    view3d.cursor = 'default';
    ball.cursor = 'grab';
  }

  ball.on('pointerdown', (e) => {
    // Kept from the view, which would orbit with the drag.
    e.stopPropagation();
    plane.setFromNormalAndCoplanarPoint(UP, ball.position);
    dragging = true;
    view3d.cursor = ball.cursor = 'grabbing';
  });
  // globalpointermove arrives wherever the pointer is, so the drag goes on when the pointer outruns the ball.
  ball.on('globalpointermove', (e) => {
    if (dragging) view3d.screenToWorld(e.global, plane, target);
  });
  ball.on('pointerup', drop);
  ball.on('pointerupoutside', drop);
}
