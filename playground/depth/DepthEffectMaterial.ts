import type { BaseMaterial3DOptions } from '@pixi/3d';
import { BaseMaterial3D, RenderPassBit, screenSpaceFuncsBit } from '@pixi/3d';

import { depthEffectBit } from './depthEffectBit';

/**
 * Demonstration material that reads the opaque scene depth texture to
 * produce a holographic "force-field" effect.
 *
 * - Renders in the **blended-refraction pass** — the alpha-blend-capable
 *   pass that samples the opaque depth copy, so routing through it both
 *   binds `uOpaqueDepthTexture` and anchors `CopyDepthPass` in the graph.
 * - **Double-sided** by default so the effect is visible from inside the
 *   mesh as well (e.g. a sphere enclosing other geometry).
 * - Uses {@link depthEffectBit} for its fragment logic — the only shader
 *   bit needed since the vertex transform comes from the engine's standard
 *   vertex path.
 */
export class DepthEffectMaterial extends BaseMaterial3D {
  constructor(options: BaseMaterial3DOptions = {}) {
    // screenSpaceFuncsBit provides `screenUVFromWorld`, called by depthEffectBit.
    const bits = [screenSpaceFuncsBit, depthEffectBit];

    super({
      ...options,
      alphaMode: 'blend',
      doubleSided: options.doubleSided ?? true,
      descriptor: { bitsGpu: bits, bitsGl: bits },
    });

    // Same routing as WaterMaterial: BLENDED_REFRACTION is the pass that
    // samples the opaque depth copy (and keeps CopyDepth alive in the graph).
    this._passBit = RenderPassBit.BLENDED_REFRACTION;
  }
}
