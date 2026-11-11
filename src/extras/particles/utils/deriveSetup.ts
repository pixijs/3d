import { Texture } from 'pixi.js';

import type { ShaderBit } from '../../../core/shader/ShaderBit';
import { particleAlphaOverLifeBit } from '../../../scene/particles/bits/particleAlphaOverLifeBit';
import { particleColorOverLifeBit } from '../../../scene/particles/bits/particleColorOverLifeBit';
import {
  particleFlipbookOverLifeBit,
  particleFlipbookRateBit,
} from '../../../scene/particles/bits/particleFlipbookBits';
import { particleLifetimeBit } from '../../../scene/particles/bits/particleLifetimeBit';
import { particleMotionBit } from '../../../scene/particles/bits/particleMotionBit';
import { particleSizeOverLifeBit } from '../../../scene/particles/bits/particleSizeOverLifeBit';
import { particleSpinBit } from '../../../scene/particles/bits/particleSpinBit';
import type { ParticleSystem3DOptions } from '../ParticleSystem3D';

interface DerivedSetup {
  /**
   * Lifetime first, since the other bits read the age it computes. Motion is always there: `aVel`,
   * `gravity` and `drag` need it on every system.
   */
  bits: ShaderBit[];
  texture: Texture | readonly Texture[] | undefined;
  /** `null` without a shader flipbook */
  grid: [cols: number, rows: number, count: number] | null;
  /** Whether `texture` was made here, for `ParticleSystem3D.destroy` to free */
  ownsTexture: boolean;
}

/** @internal */
export function deriveSetup(opts: ParticleSystem3DOptions): DerivedSetup {
  const bits: ShaderBit[] = [particleLifetimeBit, particleMotionBit];

  if (opts.spin !== undefined) bits.push(particleSpinBit);
  if (opts.sizeEnd !== undefined) bits.push(particleSizeOverLifeBit);
  if (opts.alphaEnd !== undefined) bits.push(particleAlphaOverLifeBit);
  if (opts.colorEnd !== undefined) bits.push(particleColorOverLifeBit);

  const frames = Array.isArray(opts.texture) ? (opts.texture as readonly Texture[]) : null;

  if (!frames || frames.length <= 1 || opts.frameMode === 'random') {
    return { bits, texture: opts.texture, grid: null, ownsTexture: false };
  }

  bits.push(opts.frameMode === 'animate' ? particleFlipbookRateBit : particleFlipbookOverLifeBit);

  const source = frames[0].source;

  for (let i = 1; i < frames.length; i++) {
    if (frames[i].source !== source) {
      throw new Error(
        `[ParticleSystem3D] frameMode '${opts.frameMode}' needs every frame on one sheet; frame ${i} is on another source.`,
      );
    }
  }

  const cols = Math.max(1, Math.round(source.width / frames[0].width));
  const rows = Math.max(1, Math.round(source.height / frames[0].height));

  return { bits, texture: new Texture({ source }), grid: [cols, rows, frames.length], ownsTexture: true };
}
