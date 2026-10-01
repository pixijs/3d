/**
 * `billboards`: textured quads that turn to face the camera, scattered through a ball the camera circles. Every
 * sprite shares one soft round texture and one colour, which is the case the batcher can draw as one batch; the
 * sprites are blended, as sprites are by default, so they are also sorted back to front.
 */

import { alphaTexture, BALL_RADIUS, orbit, orbitCamera, scatterInBall } from './cloud.ts';
import type { PixelTexture } from './cloud.ts';
import { coverageScale, fieldLook } from './look.ts';
import type { SceneLook, Vec3 } from './look.ts';
import { rng } from './rng.ts';

export interface BillboardsScene {
  look: SceneLook;
  /** White, with alpha falling off from the centre to nothing at the edge. */
  texture: PixelTexture;
  /** Linear colour every sprite is tinted. */
  color: Vec3;
  count: number;
  position: Float32Array;
  /** Width and height of each sprite in world units. */
  size: Float32Array;
  /** Moves `look.camera` round its circle to `t` seconds. */
  update(seconds: number): void;
}

/** Keeps the screen about as covered as the count grows, so the ladder is per-sprite cost rather than fill. */
const COVERAGE = 2000;

function softDisc(): PixelTexture {
  return alphaTexture(64, (u, v) => (1 - Math.min(1, Math.hypot(u - 0.5, v - 0.5) * 2)) ** 2);
}

/** `count` sprites in a ball the camera circles. Sprites are unlit, so the look brings no lights of its own. */
export function billboardsScene(count: number, seed = 6): BillboardsScene {
  const random = rng(seed);
  const scale = coverageScale(count, COVERAGE, 0.1, 3);
  const size = new Float32Array(count);
  for (let i = 0; i < count; i++) size[i] = scale * random.range(0.8, 1.2);
  const position = scatterInBall(random, count, BALL_RADIUS);
  const look: SceneLook = { ...fieldLook(), camera: orbitCamera(), ambient: null, sun: null };
  return {
    look,
    texture: softDisc(),
    color: [1, 0.45, 0.12],
    count,
    position,
    size,
    update(seconds) {
      orbit(look.camera, seconds);
    },
  };
}
