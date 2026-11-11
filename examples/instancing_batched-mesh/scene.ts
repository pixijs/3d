/**
 * The props: where each slot of the swarm sits in its ring, how it's turned and sized, which clay colour it rolls,
 * and the order the slots show in
 *
 * Nothing here teaches `BatchedMesh3D`; it lays out the ring the lesson fills. Every roll is seeded, so every run
 * builds the same ring.
 */

import { Quaternion, seededRandom } from '@pixi/3d';
import type { Matrix4 } from '@pixi/3d';

import { CLAY_COLORS, CLAY_WEIGHTS } from '../shared/theme/palette';

/**
 * The rope of slots round the floor: its radius, and its oval cross-section's width, height and middle at rest. A
 * rope rather than a wide disc, so a raised stretch of it stands clear of the rest.
 */
export const ROPE = {
  radius: 7,
  width: 1.8,
  height: 1.4,
  middle: 0.95,
  /** The rope's top at rest */
  get top(): number {
    return this.middle + this.height / 2;
  },
  /** The radius of its outer edge */
  get outer(): number {
    return this.radius + this.width / 2;
  },
};
/** A clay shape is about a unit across; in a batch of `FULL_SIZE` these are a twelfth of one, give or take a quarter */
const SHAPE_SCALE = 0.085;
const FULL_SIZE = 100_000;

/** Where every slot of a batch sits at rest, how it's turned and sized, and the roll that picks its colour */
export interface SwarmLayout {
  readonly size: number;
  /**
   * How far apart neighbouring slots sit, against a batch of 100,000. The shapes grow by as much, so a smaller batch
   * still fills the rope and its shapes stay big enough to name.
   */
  readonly spacing: number;
  /** Each slot's position at rest, x, y and z */
  readonly rest: Float32Array;
  /** Each slot's turn, a quaternion's x, y, z and w */
  readonly turn: Float32Array;
  readonly scale: Float32Array;
  /** A roll from 0 to 1 for each slot, which picks its colour */
  readonly colorRoll: Float32Array;
  /** Every slot once, shuffled: the first `shown` of them are the visible ones, so hiding thins the ring evenly */
  readonly spawnOrder: Uint32Array;
}

const _turn = new Quaternion();
const _position = { x: 0, y: 0, z: 0 };
const _scale = { x: 0, y: 0, z: 0 };
const _euler = { x: 0, y: 0, z: 0 };

/** Lays out `size` slots round the ring: slot `i` at `360° × (i + 0.5) / size`, so a run of slots is a sector */
export function createSwarmLayout(size: number): SwarmLayout {
  const random = seededRandom('instancing-batched-mesh');
  const spacing = Math.cbrt(FULL_SIZE / size);
  const layout: SwarmLayout = {
    size,
    spacing,
    rest: new Float32Array(size * 3),
    turn: new Float32Array(size * 4),
    scale: new Float32Array(size),
    colorRoll: new Float32Array(size),
    spawnOrder: new Uint32Array(size),
  };

  for (let i = 0; i < size; i++) {
    const angle = (Math.PI * 2 * (i + 0.5)) / size;
    // A point in the rope's oval cross-section, even over its area.
    const out = Math.sqrt(random());
    const around = random() * Math.PI * 2;
    const radius = ROPE.radius + (out * Math.cos(around) * ROPE.width) / 2;

    layout.rest[i * 3] = Math.cos(angle) * radius;
    layout.rest[i * 3 + 1] = ROPE.middle + (out * Math.sin(around) * ROPE.height) / 2;
    layout.rest[i * 3 + 2] = Math.sin(angle) * radius;
    _euler.x = random() * Math.PI * 2;
    _euler.y = random() * Math.PI * 2;
    _euler.z = random() * Math.PI * 2;
    _turn.setFromEuler(_euler);
    layout.turn[i * 4] = _turn.x;
    layout.turn[i * 4 + 1] = _turn.y;
    layout.turn[i * 4 + 2] = _turn.z;
    layout.turn[i * 4 + 3] = _turn.w;
    layout.scale[i] = SHAPE_SCALE * spacing * (0.75 + random() * 0.5);
    layout.colorRoll[i] = random();
    layout.spawnOrder[i] = i;
  }
  for (let i = size - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const slot = layout.spawnOrder[i];

    layout.spawnOrder[i] = layout.spawnOrder[j];
    layout.spawnOrder[j] = slot;
  }

  return layout;
}

/** Slot `i`'s whole matrix at rest */
export function restMatrix(layout: SwarmLayout, i: number, out: Matrix4): Matrix4 {
  const { rest, turn, scale } = layout;

  _position.x = rest[i * 3];
  _position.y = rest[i * 3 + 1];
  _position.z = rest[i * 3 + 2];
  _turn.set(turn[i * 4], turn[i * 4 + 1], turn[i * 4 + 2], turn[i * 4 + 3]);
  _scale.x = _scale.y = _scale.z = scale[i];

  return out.compose(_position, _turn, _scale);
}

/** The first `colors` clay colours' weights, summed and scaled to 0 to 1, rebuilt only when `colors` changes */
const thresholds = new Float32Array(CLAY_COLORS.length);
let thresholdColors = 0;

/** Slot `i`'s colour among the first `colors` of `CLAY_COLORS`, as often as `CLAY_WEIGHTS` says */
export function colorIndexOf(layout: SwarmLayout, i: number, colors: number): number {
  if (colors !== thresholdColors) {
    let total = 0;

    for (let c = 0; c < colors; c++) total += CLAY_WEIGHTS[CLAY_COLORS[c]];
    for (let c = 0, sum = 0; c < colors; c++) thresholds[c] = (sum += CLAY_WEIGHTS[CLAY_COLORS[c]]) / total;
    thresholdColors = colors;
  }

  const roll = layout.colorRoll[i];
  let c = 0;

  while (c < colors - 1 && roll >= thresholds[c]) c++;

  return c;
}
