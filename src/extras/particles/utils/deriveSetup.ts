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

/**
 * What the options resolve to before the container is built
 * @internal
 */
interface DerivedSetup {
  /** The behaviour bits the options imply, lifetime first */
  bits: ShaderBit[];
  /** What the container binds: the frames, or the whole sheet as one texture */
  texture: Texture | readonly Texture[] | undefined;
  /** The sheet grid a shader flipbook reads, or `null` when frames are picked at spawn */
  grid: [cols: number, rows: number, count: number] | null;
  /** Whether `texture` is a wrapper made here, for the system to free, rather than the caller's own */
  ownsTexture: boolean;
}

/**
 * Resolves what the options imply about the shader before the container is built
 *
 * The container derives its vertex layout from its bits in its own constructor, so
 * the system settles which behaviour bits to compose, in order, and what the
 * container should bind as its texture before calling it. Lifetime always leads
 * because every other bit reads the age it derives, and motion is always present
 * because a system with nothing but drift still integrates velocity. The rest
 * follow the options one for one.
 *
 * A shader flipbook, `'animate'` or `'overLife'` over several frames, binds the
 * whole sheet as one texture and works out each frame's cell from the grid, so
 * particles carry no frame attribute.
 * @param opts - The merged constructor options.
 * @returns The bits, the texture to bind and the flipbook grid, if any.
 * @internal
 */
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
