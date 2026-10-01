/**
 * `skinned`: N copies of one skinned glTF character, each playing the same clip from its own point in it, on a
 * grid the camera sees whole.
 *
 * Each character starts at a fraction of the clip rather than at seconds wrapped by it, which spreads the characters
 * over the clip without the data having to know how long it is.
 */

import { fieldLook, SCENE_ASPECT } from './look.ts';
import type { CameraSpec, SceneLook } from './look.ts';
import { rng } from './rng.ts';

export interface SkinnedScene {
  look: SceneLook;
  url: string;
  /** The clip every character plays, by its name in the file. */
  clip: string;
  count: number;
  /** One uniform scale for every character, which makes each 1.6 units tall. */
  scale: number;
  /** `count × 3` positions on the ground plane. */
  position: Float32Array;
  /** `count × 4` quaternions, each a turn about +Y. */
  quat: Float32Array;
  /** Where each character starts in the clip, as a fraction of its duration. */
  offset: Float32Array;
}

/** The model as `benchy assets` records it: where it is served, and its vertices' extent. */
export interface SkinnedModel {
  url: string;
  bounds: { min: number[]; max: number[] };
}

/** Characters are this tall once scaled, whatever units the model is authored in. */
const HEIGHT = 1.6;

/**
 * `count` Foxes, playing `Walk`. The model is Y-up, so its height is the Y extent of
 * its vertices; its footprint is the larger of the other two, which sets the grid's spacing.
 */
export function skinnedScene(fox: SkinnedModel, count: number, seed = 8): SkinnedScene {
  const random = rng(seed);
  const { min, max } = fox.bounds;
  const extent = (axis: number): number => (max[axis] ?? 0) - (min[axis] ?? 0);
  const scale = HEIGHT / extent(1);
  const spacing = Math.max(1.4, Math.max(extent(0), extent(2)) * scale * 1.1);
  const columns = Math.ceil(Math.sqrt(count * 1.6));
  const rows = Math.ceil(count / columns);
  const position = new Float32Array(count * 3);
  const quat = new Float32Array(count * 4);
  const offset = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    position[i * 3] = ((i % columns) - (columns - 1) / 2) * spacing;
    position[i * 3 + 2] = (Math.floor(i / columns) - (rows - 1) / 2) * spacing;
    const half = random.range(-0.6, 0.6) / 2;
    quat[i * 4 + 1] = Math.sin(half);
    quat[i * 4 + 3] = Math.cos(half);
    offset[i] = random.next();
  }
  const width = columns * spacing;
  const depth = rows * spacing;
  const distance = Math.max(width / SCENE_ASPECT, depth) * 0.95 + 4;
  const camera: CameraSpec = {
    position: [0, distance * 0.55, distance * 0.8],
    target: [0, 0.5, 0],
    fovY: 50,
    near: 0.1,
    far: distance * 4,
  };
  return {
    look: {
      ...fieldLook(),
      camera,
    },
    url: fox.url,
    clip: 'Walk',
    count,
    scale,
    position,
    quat,
    offset,
  };
}
