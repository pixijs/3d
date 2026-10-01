/**
 * The `post` scene as plain data: the lit field at a modest count, and the settings of the screen-space effects
 * that run over it.
 *
 * Ambient occlusion runs at sixteen samples a pixel.
 */

import { fieldScene } from './field.ts';
import type { FieldScene } from './field.ts';
import { greyMaterial } from './look.ts';

/** The effects over the scene: none, bloom, or ambient occlusion and then bloom over the occluded frame. */
export type PostEffects = 'none' | 'bloom' | 'bloom-ao';

export interface BloomSpec {
  /** How much of the glow is added back onto the frame. */
  strength: number;
  /** Brightness above which a pixel blooms. */
  threshold: number;
  /** How far the glow spreads, 0 to 1. */
  radius: number;
}

export interface AoSpec {
  /** World units a sample reaches from the pixel it occludes. */
  radius: number;
  /** Samples per pixel. */
  samples: number;
}

export interface PostScene extends FieldScene {
  bloom: BloomSpec;
  ao: AoSpec;
}

const COUNT = 2000;

export function postScene(seed = 6): PostScene {
  return {
    ...fieldScene(COUNT, [greyMaterial()], seed),
    bloom: { strength: 0.6, threshold: 0.85, radius: 0.5 },
    ao: { radius: 0.5, samples: 16 },
  };
}
