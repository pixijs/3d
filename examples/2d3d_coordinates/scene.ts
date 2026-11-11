/**
 * The props: the clay pieces on the floor and where they stand, the motion that brings them in, turns them and takes
 * them away, the record of the pieces taps placed, and the tap the lesson listens for
 *
 * A piece's `root` sits at its base, so the point a tap gives is the point it stands on, and its `top` is the point
 * just over it that its name tag pins to. None of this is the lesson.
 */

import { Container3D, Mesh3D, Vector3 } from '@pixi/3d';
import type { PointData3D, View3D } from '@pixi/3d';
import { Point } from 'pixi.js';
import type { FederatedPointerEvent, Text, TextStyleOptions } from 'pixi.js';

import { clayMaterial } from '../shared/theme/clay';
import { BRAND } from '../shared/theme/palette';
import type { ClayColor } from '../shared/theme/palette';
import { clayGeometry } from '../shared/theme/shapes';
import type { ClayShape } from '../shared/theme/shapes';

/** The base row, evenly spaced in a shallow arc behind the world origin; the pyramid at its right end has its own */
export const BASE_PIECES = [
  { shape: 'cube', color: 'pink', at: { x: -2.1, y: 0, z: -1.1 } },
  { shape: 'sphere', color: 'purple', at: { x: -0.7, y: 0, z: -1.7 } },
  { shape: 'torus', color: 'orange', at: { x: 0.7, y: 0, z: -1.7 } },
] as const;

/** Where the pyramid stands: the row's right end, the piece whose line back to the camera the side view draws */
export const PYRAMID_AT = { x: 2.1, y: 0, z: -1.1 };

/**
 * The two floor spots the first frame shows, in front of the base row. Near, where the pointer aims until the reader
 * moves theirs, is on the camera's line to the origin, clear of the side view in the bottom-right corner; left holds a
 * placed piece from the start, far enough forward that its tag stays below the cube on screen as the camera orbits.
 */
export const SPOTS = {
  near: { x: 0, y: 0, z: 3.6 },
  left: { x: -1.2, y: 0, z: 3.25 },
} as const;

/** How many placed pieces stand at once; past it, the oldest goes */
const MAX_PLACED = 3;
/** A new piece this close to a placed one, in units, takes its place, as a tap on a piece should */
const REPLACE_RADIUS = 0.6;
/**
 * What taps place, in turn: the shapes and colours the base row doesn't use, so a placed tag never repeats a base one.
 * The puck comes first since it stands on the left spot from the start, and it's short enough that its tag stays low.
 */
const PLACED_SHAPES = ['puck', 'capsule', 'octahedron'] as const;
const PLACED_COLORS = ['palePink', 'lilac', 'paleSky', 'white'] as const;
/** The clay shapes' scale: a unit across is too big for the near floor, where taps drop them */
const PIECE_SCALE = 0.8;
/** The gap between a piece's top and the point its tag pins to */
const TAG_GAP = 0.06;
/** Radians a second a base piece turns: slow enough to read as still life */
const TURN_SPEED = 0.3;
/** A new piece falls this far onto the floor, in this many seconds, then squashes this much for this long */
const FALL = { height: 0.3, seconds: 0.3 };
const SQUASH = { amount: 0.18, seconds: 0.15 };
/** Seconds a piece placed in the air takes to pop up, and a removed one to shrink away */
const POP_SECONDS = 0.25;
const SHRINK_SECONDS = 0.25;
/** Px a press can move and still count as a tap: pixi fires `pointertap` at the end of an orbit drag too */
const TAP_SLOP = 6;

/** A game's name tag, the same on both themes: white with a dark outline reads over floor, sky and clay */
export const TAG_STYLE: TextStyleOptions = {
  fontFamily: 'system-ui, sans-serif',
  fontSize: 15,
  fontWeight: 'bold',
  fill: BRAND.white,
  stroke: { color: BRAND.night, width: 4, join: 'round' },
};

/** A clay piece and its name tag */
export interface Piece {
  /** At the piece's base: the point it stands on */
  readonly root: Container3D;
  /** The point just over its top, in `root`'s space */
  readonly top: Vector3;
  /** Its name tag, a plain pixi Text */
  readonly tag: Text;
}

/** A clay shape on a root at its base, and the point over its top */
export function createClay(shape: ClayShape, color: ClayColor, at: PointData3D): Omit<Piece, 'tag'> {
  const geometry = clayGeometry(shape);
  const { min, max } = geometry.bounds3D;
  const root = new Container3D({ position: at });

  // The shapes are built round their middle; lifted, the root's position is the point the piece stands on.
  new Mesh3D({
    geometry,
    material: clayMaterial(color),
    position: { x: 0, y: -min.y * PIECE_SCALE, z: 0 },
    scale: PIECE_SCALE,
    parent: root,
  });

  return { root, top: new Vector3(0, (max.y - min.y) * PIECE_SCALE + TAG_GAP, 0) };
}

/** A piece coming in or going away: how, how long it has run, and the height it rests at */
interface Motion {
  readonly root: Container3D;
  readonly kind: 'fall' | 'pop' | 'shrink';
  readonly restY: number;
  time: number;
}

export interface PieceMotion {
  /** Turns a piece slowly about its upright axis, from `phase` radians */
  turn(root: Container3D, phase: number): void;
  /** Brings a new piece in: it falls onto the floor, or, standing in the air, pops up where it is */
  arrive(root: Container3D, falls: boolean): void;
  /** Shrinks a piece away, then destroys it; the clay geometry and material are the kit's and stay */
  remove(root: Container3D): void;
  update(dt: number): void;
}

export function createPieceMotion(): PieceMotion {
  const turning: Container3D[] = [];
  const moving: Motion[] = [];

  /** Moves one piece on; `true` once its motion is over */
  function step(motion: Motion): boolean {
    const { root, restY, time } = motion;

    switch (motion.kind) {
      case 'fall': {
        const fall = Math.min(time / FALL.seconds, 1);
        const squash = Math.max(0, Math.min((time - FALL.seconds) / SQUASH.seconds, 1));
        const flatten = SQUASH.amount * Math.sin(Math.PI * squash);

        // Eased in, the way a dropped thing speeds up.
        root.position.y = restY + FALL.height * (1 - fall * fall);
        root.scale.set(1 + flatten / 2, 1 - flatten, 1 + flatten / 2);

        return squash >= 1;
      }
      case 'pop': {
        const s = Math.min(time / POP_SECONDS, 1) - 1;

        // Eased out with a small overshoot.
        root.scale.set(1 + 2.7 * s * s * s + 1.7 * s * s);

        return s >= 0;
      }
      case 'shrink': {
        const s = Math.max(1 - time / SHRINK_SECONDS, 0);

        root.scale.set(s);
        if (s > 0) return false;
        root.destroy({ children: true });

        return true;
      }
    }
  }

  function start(root: Container3D, kind: Motion['kind']): void {
    const index = moving.findIndex((motion) => motion.root === root);

    if (index >= 0) moving.splice(index, 1);
    moving.push({ root, kind, restY: root.position.y, time: 0 });
    step(moving[moving.length - 1]);
  }

  return {
    turn(root, phase) {
      root.rotation.y = phase;
      turning.push(root);
    },
    arrive(root, falls) {
      start(root, falls ? 'fall' : 'pop');
    },
    remove(root) {
      start(root, 'shrink');
    },
    update(dt) {
      for (const root of turning) root.rotation.y += TURN_SPEED * dt;
      for (let i = moving.length - 1; i >= 0; i--) {
        moving[i].time += dt;
        if (step(moving[i])) moving.splice(i, 1);
      }
    },
  };
}

export interface PlacerOptions {
  /** Every piece with a name tag: a placed piece joins it, and leaves it when it goes */
  pieces: Piece[];
  motion: PieceMotion;
  /** Builds a piece and its tag, and adds it to `pieces` */
  add: (shape: ClayShape, color: ClayColor, at: PointData3D) => Piece;
}

export interface Placer {
  /** Places the next piece at `at`, in place of a placed piece standing there, or of the oldest once there are three */
  place(at: PointData3D): Piece;
  /** Takes every placed piece away */
  clear(): void;
}

/** The pieces taps place: each takes the next look in turn, and one shrinks away to make room */
export function createPlacer({ pieces, motion, add }: PlacerOptions): Placer {
  const placed: Piece[] = [];
  let count = 0;

  function remove(piece: Piece): void {
    pieces.splice(pieces.indexOf(piece), 1);
    piece.tag.destroy();
    motion.remove(piece.root);
  }

  return {
    place(at) {
      const there = placed.findIndex(({ root: { position: p } }) => {
        return Math.hypot(p.x - at.x, p.y - at.y, p.z - at.z) < REPLACE_RADIUS;
      });
      const replaced = there >= 0 ? there : placed.length === MAX_PLACED ? 0 : -1;

      if (replaced >= 0) remove(placed.splice(replaced, 1)[0]);
      placed.push(add(PLACED_SHAPES[count % PLACED_SHAPES.length], PLACED_COLORS[count % PLACED_COLORS.length], at));
      count++;

      return placed[placed.length - 1];
    },
    clear() {
      for (const piece of placed) remove(piece);
      placed.length = 0;
    },
  };
}

/** Calls `listener` for a tap on `view3d`, and not for the end of an orbit drag, which pixi also sends `pointertap` for */
export function onTap(view3d: View3D, listener: (e: FederatedPointerEvent) => void): void {
  const pressedAt = new Point();

  view3d.on('pointerdown', (e) => pressedAt.copyFrom(e.global));
  view3d.on('pointertap', (e) => {
    if (Math.hypot(e.global.x - pressedAt.x, e.global.y - pressedAt.y) < TAP_SLOP) listener(e);
  });
}
