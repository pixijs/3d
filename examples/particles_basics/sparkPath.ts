/**
 * One spark's flight worked out on the CPU, with the formula the particle motion shader runs, so a path drawn from it
 * lands on the sparks, and the reads of a sampled flight: its highest point and where it crosses a height
 */

import type { PointData3D, Vector3 } from '@pixi/3d';
import { BoxShape, ConeShape, SphereShape } from '@pixi/3d/extras';
import type { EmitterShape } from '@pixi/3d/extras';
import { DEG_TO_RAD } from 'pixi.js';

/** The drawn spark's launch off straight up, inside the cone's edge where the sparks are thick */
const TILT = 20 * DEG_TO_RAD;
/** Below this drag the shader takes the drag-free form, which is also the exact limit */
const NO_DRAG = 1e-4;

/**
 * Where a spark launched from `from` at `velocity` is `t` seconds later, under a downward `gravity` and `drag`
 *
 * It's the shader's closed form: p = p0 + v·a + g·b, with a = (1 − e^(−kt)) / k and b = (t − a) / k for drag k,
 * which tend to t and t²/2 as k goes to 0.
 */
function sparkPosition(
  out: Vector3,
  from: PointData3D,
  velocity: PointData3D,
  gravity: number,
  drag: number,
  t: number,
): Vector3 {
  let a = t;
  let b = (t * t) / 2;

  if (drag > NO_DRAG) {
    a = (1 - Math.exp(-drag * t)) / drag;
    b = (t - a) / drag;
  }

  return out.set(from.x + velocity.x * a, from.y + velocity.y * a - gravity * b, from.z + velocity.z * a);
}

/**
 * One launch the shape makes, in the emitter's space, in the upright plane along `right`: where a spark starts
 * and the way it heads
 *
 * A cone or a sphere launches tilted toward `right`, a box from its edge on that side and a point from the middle,
 * both straight up as they always do. Returns whether the launch is straight up.
 */
export function launchFor(shape: EmitterShape, right: PointData3D, outFrom: Vector3, outDirection: Vector3): boolean {
  if (shape instanceof ConeShape || shape instanceof SphereShape) {
    const tilt = shape instanceof ConeShape ? Math.min(TILT, shape.angle * DEG_TO_RAD) : TILT;
    const across = Math.sin(tilt);

    outDirection.set(right.x * across, Math.cos(tilt), right.z * across);
    // A sphere's sparks head straight out of it, so this one starts on its surface.
    if (shape instanceof SphereShape) outFrom.copyFrom(outDirection).multiplyScalar(shape.radius);
    else outFrom.set(0, 0, 0);

    return false;
  }

  outDirection.set(0, 1, 0);
  if (shape instanceof BoxShape) outFrom.set((right.x * shape.width) / 2, 0, (right.z * shape.depth) / 2);
  else outFrom.set(0, 0, 0);

  return true;
}

/**
 * Samples a flight into `out`, three numbers a point, from launch to `life` seconds, and stops once it falls back
 * below the height it started at
 * @returns How many points it wrote.
 */
export function sampleFlight(
  out: Float32Array,
  from: PointData3D,
  velocity: PointData3D,
  gravity: number,
  drag: number,
  life: number,
  scratch: Vector3,
): number {
  const samples = out.length / 3;

  for (let i = 0; i < samples; i++) {
    const point = sparkPosition(scratch, from, velocity, gravity, drag, (i / (samples - 1)) * life);

    if (i > 0 && point.y < from.y) return i;
    out[i * 3] = point.x;
    out[i * 3 + 1] = point.y;
    out[i * 3 + 2] = point.z;
  }

  return samples;
}

/** The index of a sampled path's highest point */
export function highest(xyz: Float32Array, count: number): number {
  let best = 0;

  for (let i = 1; i < count; i++) if (xyz[i * 3 + 1] > xyz[best * 3 + 1]) best = i;

  return best;
}

/** Where a sampled path, between points `first - 1` and `last`, first crosses `height`, written into `out` */
export function crossing(xyz: Float32Array, first: number, last: number, height: number, out: Vector3): boolean {
  for (let i = first; i <= last; i++) {
    const a = xyz[(i - 1) * 3 + 1] - height;
    const b = xyz[i * 3 + 1] - height;

    if (a * b > 0 || a === b) continue;

    const t = a / (a - b);

    out.set(
      xyz[(i - 1) * 3] + (xyz[i * 3] - xyz[(i - 1) * 3]) * t,
      height,
      xyz[(i - 1) * 3 + 2] + (xyz[i * 3 + 2] - xyz[(i - 1) * 3 + 2]) * t,
    );

    return true;
  }

  return false;
}
