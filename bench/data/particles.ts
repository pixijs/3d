/**
 * `particles`: one emitter keeping N particles alive. Each is launched from inside a small sphere, straight out
 * from its centre, lives a fixed time under gravity and linear drag, and shrinks and changes colour over its
 * life; the emitter replaces the whole pool once per lifetime.
 *
 * The camera sits fifty-five units back, and the particles shrink as the count grows so the screen stays about as
 * covered.
 */

import { fieldLook } from './look.ts';
import type { CameraSpec, SceneLook, Vec3 } from './look.ts';

export interface ParticlesScene {
  look: SceneLook;
  /** The pool's size, and how many particles are alive once the emitter has run for one lifetime. */
  count: number;
  /** Seconds every particle lives. */
  life: number;
  /** Launch points fill a sphere of this radius around the origin. */
  radius: number;
  /** Launch speed, drawn uniformly from this range, along the direction out of the sphere's centre. */
  speed: [number, number];
  /** Downward acceleration, units per second squared. */
  gravity: number;
  /** Linear drag: velocity decays as `e^(−drag · t)`. */
  drag: number;
  /** World-space diameter at birth and at death, interpolated linearly over the life. */
  size: number;
  sizeEnd: number;
  /** Linear colours at birth and at death, interpolated linearly over the life. */
  color: Vec3;
  colorEnd: Vec3;
  /** The seed the emitter draws its spawns from. */
  seed: number;
}

const CAMERA: CameraSpec = { position: [0, 0, 55], target: [0, 0, 0], fovY: 50, near: 0.5, far: 200 };

/** An emitter keeping `count` particles alive. */
export function particlesScene(count: number, seed = 9): ParticlesScene {
  const size = 0.05 * Math.sqrt(1e6 / count);
  return {
    look: { ...fieldLook(), camera: { ...CAMERA }, sun: null },
    count,
    life: 2.5,
    radius: 2,
    speed: [4, 10],
    gravity: 4,
    drag: 0.5,
    size,
    sizeEnd: size * 0.5,
    color: [1, 0.45, 0.08],
    colorEnd: [0.08, 0.25, 1],
    seed,
  };
}
