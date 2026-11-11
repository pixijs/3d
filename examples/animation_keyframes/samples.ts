/**
 * What the visuals read from the animations: where the keyframes are, and the line each interpolation draws between
 * them
 *
 * The keys and lines are worked out once, at the start, with `track.evaluate`, the call the player makes, so the
 * lines are exactly what plays.
 */

import { Quaternion, QuaternionTrack, Vector3, Vector3Track } from '@pixi/3d';
import type { Animation, PointData3D, Track } from '@pixi/3d';

/** Seconds between a path's points, one a frame at 60 fps */
const PATH_STEP = 1 / 60;

/** The keyframes, which every one of the animations shares */
export interface Keys {
  /** Every position keyframe, xyz, track by track */
  positions: Float32Array;
  /** Each one's time */
  times: number[];
  /** Whether each one is its track's last, where the piece lands in its place */
  landing: boolean[];
  /** The rotation track's keyframes, each with its node's position at the same time */
  turns: { position: Vector3; quaternion: Quaternion }[];
}

/** What one position track draws between its keyframes, all xyz */
export interface Line {
  /** The node it moves */
  node: string;
  /** When the piece lands in its place: the track's last keyframe */
  lands: number;
  /** The track from its first keyframe to its last */
  points: Float32Array;
  /** The same, up to where it meets the piece's outline in its place: what's drawn once the piece has landed */
  landed: Float32Array;
  /** In `'CUBICSPLINE'`, the tangent handle through each middle keyframe: its back end, then its front end */
  handles: Float32Array;
}

/** A piece's outline in its place, as the camera sees it from in front: its x and y extents in the logo's space */
type Outline = Record<'left' | 'bottom' | 'right' | 'top', number>;

const _value = new Float32Array(4);

/** The node a track drives: its label up to the last `.` */
const nodeOf = (track: Track): string => track.label.slice(0, track.label.lastIndexOf('.'));

/** Reads the keyframes of an animation's position tracks and of its rotation track */
export function readKeys(animation: Animation): Keys {
  const positions: number[] = [];
  const times: number[] = [];
  const landing: boolean[] = [];
  const turns: Keys['turns'] = [];
  /** Each position track by the node it moves */
  const moves: Record<string, Track> = {};

  for (const track of animation.tracks) {
    if (!(track instanceof Vector3Track)) continue;
    moves[nodeOf(track)] = track;
    track.times.forEach((time, i) => {
      positions.push(...sample(track, time));
      times.push(time);
      landing.push(i === track.times.length - 1);
    });
  }
  for (const track of animation.tracks) {
    if (!(track instanceof QuaternionTrack)) continue;
    for (const time of track.times) {
      const position = new Vector3().fromArray(sample(moves[nodeOf(track)], time));

      turns.push({ position, quaternion: new Quaternion().fromArray(sample(track, time)) });
    }
  }

  return { positions: new Float32Array(positions), times, landing, turns };
}

/**
 * Samples each of an animation's position tracks; `pieces` gives each node's half extents, the size of its place
 *
 * A `'STEP'` animation has no lines: nothing exists between its keyframes, so the piece holds each one, then jumps.
 */
export function sampleLines(animation: Animation, pieces: Readonly<Record<string, { half: PointData3D }>>): Line[] {
  const lines: Line[] = [];

  for (const track of animation.tracks) {
    if (!(track instanceof Vector3Track) || track.interpolation === 'STEP') continue;

    const { times, interpolation } = track;
    const node = nodeOf(track);
    const end = times[times.length - 1];
    const { half } = pieces[node];
    const [x, y] = sample(track, end);
    // Depth is left out: a line that meets the outline is in front of the piece or behind it, and either way it would
    // show through the piece's holes and engraving.
    const place = { left: x - half.x, bottom: y - half.y, right: x + half.x, top: y + half.y };
    const points: number[] = [];

    for (let i = 0, steps = Math.ceil((end - times[0]) / PATH_STEP); i <= steps; i++) {
      points.push(...sample(track, Math.min(times[0] + i * PATH_STEP, end)));
    }
    lines.push({
      node,
      lands: end,
      points: new Float32Array(points),
      landed: new Float32Array(clipAt(points, place)),
      handles: new Float32Array(interpolation === 'CUBICSPLINE' ? handlesOf(track) : []),
    });
  }

  return lines;
}

/**
 * The tangent handle through each middle keyframe of a `'CUBICSPLINE'` track, two points each
 *
 * Each key stores in-tangent, value, out-tangent. The handle runs to the Bézier control points the curve is equivalent
 * to, a third of each neighbouring gap along its tangent, so it lies along the curve.
 */
function handlesOf({ times, values }: Track): number[] {
  const handles: number[] = [];

  for (let i = 1; i < times.length - 1; i++) {
    const before = (times[i] - times[i - 1]) / 3;
    const after = (times[i + 1] - times[i]) / 3;

    for (let k = 0; k < 3; k++) handles.push(values[i * 9 + 3 + k] - values[i * 9 + k] * before);
    for (let k = 0; k < 3; k++) handles.push(values[i * 9 + 3 + k] + values[i * 9 + 6 + k] * after);
  }

  return handles;
}

/** Whether point `i` lies inside `outline` */
const inside = (xyz: readonly number[], i: number, { left, bottom, right, top }: Outline): boolean =>
  xyz[i * 3] >= left && xyz[i * 3] <= right && xyz[i * 3 + 1] >= bottom && xyz[i * 3 + 1] <= top;

/** The points up to where the line crosses into `outline`, ending on its edge */
function clipAt(points: readonly number[], outline: Outline): number[] {
  let i = points.length / 3 - 1;

  while (i > 0 && inside(points, i, outline)) i--;

  const out = points.slice(0, (i + 1) * 3);
  const [x0, y0, z0, x1, y1, z1] = points.slice(i * 3, i * 3 + 6);
  let t = 0;

  // Along the step from the last point outside to the first inside, the line crosses the edge it's outside of last.
  if (x0 < outline.left) t = Math.max(t, (outline.left - x0) / (x1 - x0));
  if (x0 > outline.right) t = Math.max(t, (outline.right - x0) / (x1 - x0));
  if (y0 < outline.bottom) t = Math.max(t, (outline.bottom - y0) / (y1 - y0));
  if (y0 > outline.top) t = Math.max(t, (outline.top - y0) / (y1 - y0));
  out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t);

  return out;
}

/** A track's value at a time, in a scratch array that the next call overwrites */
function sample(track: Track, time: number): Float32Array {
  track.evaluate(time, 0, _value);

  return _value.subarray(0, track.valueSize);
}
