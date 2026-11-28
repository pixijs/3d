/** The props: the corkscrew both ribbons run along, and the per-point widths and colours the pane switches on */

import { srgbToLinear } from '@pixi/3d';
import { Color } from 'pixi.js';

/** Points in one turn of the corkscrew: enough that its curve reads smooth at the near end */
const POINTS_PER_TURN = 24;
/** Turns from the front of the floor to the back */
const TURNS = 6;
/** Radius of each turn, and the height its axis runs at */
const RADIUS = 0.45;
const AXIS_HEIGHT = 1.2;
/** Where the corkscrew starts and ends along z: near the camera, then far down the floor */
const NEAR_Z = 3;
const FAR_Z = -10;

/** How many points each corkscrew has */
export const POINT_COUNT = POINTS_PER_TURN * TURNS + 1;
/** The points on the outer sides of the nearest turn: its left, half a turn round, and its right, where it starts */
export const FIRST_TURN_LEFT = POINTS_PER_TURN / 2;
export const FIRST_TURN_RIGHT = 0;

/** x, y and z of every point of a corkscrew running away from the camera, its axis at `x` */
export function corkscrewPoints(x: number): Float32Array {
  const points = new Float32Array(POINT_COUNT * 3);

  for (let i = 0; i < POINT_COUNT; i++) {
    const angle = (i / POINTS_PER_TURN) * Math.PI * 2;

    points[i * 3] = x + Math.cos(angle) * RADIUS;
    points[i * 3 + 1] = AXIS_HEIGHT + Math.sin(angle) * RADIUS;
    points[i * 3 + 2] = NEAR_Z + ((FAR_Z - NEAR_Z) * i) / (POINT_COUNT - 1);
  }

  return points;
}

/** One width per point, swelling from nothing at the ends to `width` halfway along */
export function taperedWidths(width: number): Float32Array {
  const widths = new Float32Array(POINT_COUNT);

  for (let i = 0; i < POINT_COUNT; i++) widths[i] = width * Math.sin((i / (POINT_COUNT - 1)) * Math.PI);

  return widths;
}

/**
 * One RGBA colour per point, from `near` at the first point to `far` at the last. Vertex colours are linear light, the
 * scale the lighting works in, so each sRGB colour picked from the palette is converted first or it comes out pale.
 */
export function gradientColors(near: number, far: number): Float32Array {
  const from = Color.shared.setValue(near).toRgbArray().map(srgbToLinear);
  const to = Color.shared.setValue(far).toRgbArray().map(srgbToLinear);
  const colors = new Float32Array(POINT_COUNT * 4);

  for (let i = 0; i < POINT_COUNT; i++) {
    const t = i / (POINT_COUNT - 1);

    for (let c = 0; c < 3; c++) colors[i * 4 + c] = from[c] + (to[c] - from[c]) * t;
    colors[i * 4 + 3] = 1;
  }

  return colors;
}
