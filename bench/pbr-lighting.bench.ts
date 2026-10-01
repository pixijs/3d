/**
 * `pbr-lighting`: what a point light costs in the material pass. The PBR material scene (five lit, textured,
 * normal-mapped strips across the view, image-based lighting, ACES) with one, four and eight point lights, all within
 * range of every fragment, so no light is skipped anywhere. The frame is static, so its `gpu.frame` is the GPU work of
 * that pass and nothing moving around it. One sample per pixel unless `--msaa 4` asks.
 *
 * The rungs differ only in how many lights there are, so what they measure is what each light adds.
 */

import { gpu } from 'benchy';

import { pbrScene } from './pbr.ts';
import type { PixiStage } from './stage.ts';

gpu('pbr-lighting', {
  variants: { lights1: { lights: 1 }, lights4: { lights: 4 }, lights8: { lights: 8 } },
  gate: 'strict',
  antialias: false,
  options: { cull: 'off' },
  create(stage: PixiStage, { lights }) {
    return pbrScene(stage, lights);
  },
});
