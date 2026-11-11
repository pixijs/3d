/**
 * `hdr`: what drawing the scene as linear light costs over drawing it straight to display.
 *
 * Every variant runs the same lit field under one effect; only where the tone curve runs differs:
 *
 * - `copy-display`: a copy effect after the tone curve. The curve stays in the materials and the scene is 8-bit, as
 *   in a view whose effects all run after the curve.
 * - `copy-linear`: the same copy as a `'beforeToneMapping'` effect. The scene is `rgba16float` with no curve in the
 *   materials, and an output pass applies the curve after the copy. Against `copy-display` this is the floor the
 *   linear mode adds: the float scene and the output pass.
 * - `bloom-display`: `BloomEffect` moved after the curve with `stage: 'afterToneMapping'`, on the 8-bit display image.
 * - `bloom-linear`: `BloomEffect` as it ships, on the float scene with its blur levels in `rg11b10ufloat`, then the output
 *   pass.
 *
 * The curve is `'aces'` and multisampling is off, judged on `gpu.frame`. The view culls on the CPU (`cull: 'cpu'`) so every run draws the
 * same frame.
 */

import { BloomEffect } from '@pixi/3d/extras';
import { frame } from 'benchy';

import { CopyEffect } from './copy.ts';
import { postScene } from './data/post.ts';
import { meshPerObject } from './meshes.ts';
import { applyLook } from './stage.ts';
import type { PixiStage } from './stage.ts';

type Effect = 'copy-display' | 'copy-linear' | 'bloom-display' | 'bloom-linear';

frame('hdr', {
  variants: {
    'copy-display': { effect: 'copy-display' },
    'copy-linear': { effect: 'copy-linear' },
    'bloom-display': { effect: 'bloom-display' },
    'bloom-linear': { effect: 'bloom-linear' },
  },
  primary: 'gpu.frame',
  antialias: false,
  options: { cull: 'cpu' },
  create(stage: PixiStage, { effect: kind }: { effect: Effect }) {
    const data = postScene();
    applyLook(stage, data.look);
    const scene = meshPerObject(stage, data);

    const effect =
      kind === 'copy-display'
        ? new CopyEffect({ stage: 'afterToneMapping' })
        : kind === 'copy-linear'
          ? new CopyEffect({ stage: 'beforeToneMapping' })
          : kind === 'bloom-display'
            ? new BloomEffect({ stage: 'afterToneMapping' })
            : new BloomEffect();
    stage.view.toneMapping = 'aces';
    stage.view.passes = [effect];

    return {
      ...scene,
      destroy() {
        effect.destroy();
        scene.destroy?.();
      },
    };
  },
});
