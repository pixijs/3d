/**
 * `sprite-textures`: 1000 blended `Sprite3D`s in a ball the camera circles, each built from a texture, so each
 * owns a `FlatMaterial`, over `textures` images. The back-to-front sort interleaves the images.
 *
 * - `k4`: four images, each its own texture source, as four separately loaded PNGs are.
 * - `k1`: one image: one texture set, so every sprite can share a run.
 * - `k8`: eight sources, so neighbours in the sort share an image half as often as in `k4`.
 * - `sheet4`: four frames of one sprite sheet, so one source and one texture set.
 *
 * Judged on `cpu.render`, where the sort, the walk and the per-draw encoding are.
 */

import { Sprite3D } from '@pixi/3d';
import { frame } from 'benchy';
import { Rectangle, Texture } from 'pixi.js';

import { alphaTexture, BALL_RADIUS, orbit, orbitCamera, scatterInBall } from './data/cloud.ts';
import type { PixelTexture } from './data/cloud.ts';
import { coverageScale, fieldLook } from './data/look.ts';
import type { SceneLook } from './data/look.ts';
import { rng } from './data/rng.ts';
import { applyLook, toTexture } from './stage.ts';
import type { PixiStage } from './stage.ts';

const COUNT = 1000;
const SIZE = 64;

/** A soft disc whose falloff steepens with `k`, so every image is a different picture. */
function disc(u: number, v: number, k: number): number {
  return (1 - Math.min(1, Math.hypot(u - 0.5, v - 0.5) * 2)) ** (1 + k);
}

/** `frames` discs side by side in one image, `SIZE` pixels square each. */
function sheet(frames: number): PixelTexture {
  const width = SIZE * frames;
  const pixels = new Uint8Array(width * SIZE * 4).fill(255);
  for (let f = 0; f < frames; f++) {
    const one = alphaTexture(SIZE, (u, v) => disc(u, v, f));
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        pixels[(y * width + f * SIZE + x) * 4 + 3] = one.pixels[(y * SIZE + x) * 4 + 3] ?? 0;
      }
    }
  }
  return { width, height: SIZE, pixels };
}

frame('sprite-textures', {
  variants: {
    k4: { textures: 4, sheet: false },
    k1: { textures: 1, sheet: false },
    k8: { textures: 8, sheet: false },
    sheet4: { textures: 4, sheet: true },
  },
  primary: 'cpu.render',
  options: { cull: 'cpu' },
  create(stage: PixiStage, { textures, sheet: fromSheet }: { textures: number; sheet: boolean }) {
    const random = rng(6050);
    const look: SceneLook = { ...fieldLook(), camera: orbitCamera(), ambient: null, sun: null };
    applyLook(stage, look);
    const { view } = stage;
    const images: Texture[] = [];
    const sources: Texture[] = [];
    if (fromSheet) {
      const atlas = toTexture(sheet(textures), 'sprite-textures-sheet');
      sources.push(atlas);
      for (let f = 0; f < textures; f++) {
        images.push(new Texture({ source: atlas.source, frame: new Rectangle(f * SIZE, 0, SIZE, SIZE) }));
      }
    } else {
      for (let f = 0; f < textures; f++) {
        images.push(
          toTexture(
            alphaTexture(SIZE, (u, v) => disc(u, v, f)),
            `sprite-textures-disc-${f}`,
          ),
        );
      }
      sources.push(...images);
    }
    const scale = coverageScale(COUNT, 2000, 0.1, 3);
    const position = scatterInBall(random, COUNT, BALL_RADIUS);
    const sprites: Sprite3D[] = [];
    for (let i = 0; i < COUNT; i++) {
      const texture = images[random.int(textures)];
      if (!texture) throw new Error(`sprite-textures: sprite ${i} has no texture`);
      const size = scale * random.range(0.8, 1.2);
      const sprite = new Sprite3D({ texture, tint: 0xff7a1f, width: size, height: size });
      sprite.position.fromArray(position, i * 3);
      sprites.push(view.root.addChild(sprite));
    }
    const eye = look.camera.position;
    const [x, y, z] = look.camera.target;
    const target = { x, y, z };
    return {
      simulate(seconds) {
        orbit(look.camera, seconds);
      },
      update() {
        view.camera.position.set(eye[0], eye[1], eye[2]);
        view.camera.lookAt(target);
      },
      destroy() {
        for (const sprite of sprites) sprite.destroy();
        for (const source of sources) source.destroy(true);
      },
    };
  },
});
