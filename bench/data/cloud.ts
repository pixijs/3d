/**
 * What the two sort scenes, `transparency` and `billboards`, share: things scattered through a ball round the
 * origin, a camera that circles it, and textures built from bytes.
 *
 * The camera moves because a still one would leave the engine a back-to-front order it could keep from one frame
 * to the next; circling makes the order the render's work every frame. The ball fits inside the frustum from
 * every point of the circle, so culling removes nothing anywhere on it and every frame is the same work.
 */

import type { CameraSpec } from './look.ts';
import type { Rng } from './rng.ts';

/** An RGBA8 texture as bytes, row by row, so every run uploads the same texels. */
export interface PixelTexture {
  width: number;
  height: number;
  /** `width × height × 4` bytes. */
  pixels: Uint8Array;
}

export const BALL_RADIUS = 12;

const ORBIT_RADIUS = 40;
const ORBIT_HEIGHT = 12;
/** Seconds per turn: a 240-frame window of 60 Hz steps turns the camera 72 degrees. */
const ORBIT_PERIOD = 20;

/** Points spread evenly through a ball of `radius` round the origin. */
export function scatterInBall(random: Rng, count: number, radius: number): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    random.unit(out, i * 3);
    const distance = radius * Math.cbrt(random.next());
    out[i * 3] = (out[i * 3] ?? 0) * distance;
    out[i * 3 + 1] = (out[i * 3 + 1] ?? 0) * distance;
    out[i * 3 + 2] = (out[i * 3 + 2] ?? 0) * distance;
  }
  return out;
}

/** The camera at the start of its circle, a little above the ball and looking at its centre. */
export function orbitCamera(): CameraSpec {
  return { position: [0, ORBIT_HEIGHT, ORBIT_RADIUS], target: [0, 0, 0], fovY: 50, near: 0.5, far: 200 };
}

/** Moves `camera` round the circle to `seconds`, in place, so a bench can hold on to its position. */
export function orbit(camera: CameraSpec, seconds: number): void {
  const angle = (seconds / ORBIT_PERIOD) * Math.PI * 2;
  camera.position[0] = Math.sin(angle) * ORBIT_RADIUS;
  camera.position[1] = ORBIT_HEIGHT;
  camera.position[2] = Math.cos(angle) * ORBIT_RADIUS;
}

/** A square white texture whose alpha is `alpha(u, v)` at each texel's centre, `u` and `v` in 0..1. */
export function alphaTexture(size: number, alpha: (u: number, v: number) => number): PixelTexture {
  const pixels = new Uint8Array(size * size * 4).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = alpha((x + 0.5) / size, (y + 0.5) / size);
      pixels[(y * size + x) * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, value)));
    }
  }
  return { width: size, height: size, pixels };
}
