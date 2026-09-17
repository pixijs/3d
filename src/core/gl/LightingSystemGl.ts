import { Color, CubeTexture, ExtensionType } from 'pixi.js';
import type { WebGLRenderer } from 'pixi.js';

import { addLinearRgb, writeLinearRgb } from '../../materials/BaseMaterial3D';
import { HEMISPHERE_DEFAULT_UP } from '../../scene/lights/environment/Hemisphere';
import type { Light } from '../../scene/lights/Light';
import { FLOATS_PER_LIGHT, MAX_LIGHTS } from '../../scene/View3D';
import type { View3D } from '../../scene/View3D';
import { RenderPassBit } from '../render-passes/RenderPass';
import { getGlobalGlData } from './shader/globalBitGl';
import type { ShadowRenderPassGl } from './ShadowRenderPassGl';

// Shared scratch for per-frame color parsing.
const scratchColor = new Color();

/**
 * WebGL counterpart to `LightingSystemGpu`
 *
 * Packs light data into flat uniforms (rather than storage buffers) and coordinates with the
 * shadow pass to compute shadow matrices.
 *
 * Per-frame, packs into the global uniform group:
 *   - Per-light data (directional / point / spot) into `view3d.lightDataBuffer`.
 *   - Ambient summed from any `AmbientLight` instances.
 *   - Hemisphere uniforms when `view3d.environment` is a hemisphere.
 *
 * Registered as a WebGL renderer system (`renderer.lighting3d`).
 * @internal
 */
export class LightingSystemGl {
  /** @ignore */
  public static extension = {
    type: [ExtensionType.WebGLSystem],
    name: 'lighting3d',
  } as const;

  private readonly _renderer: WebGLRenderer;

  constructor(renderer: WebGLRenderer) {
    this._renderer = renderer;
  }

  /**
   * Packs the frame's light and shadow state into the view's global uniform group
   * @param view3d - The view whose global uniforms receive the packed data
   * @param lights - The frame's visible-scene light list
   */
  public update(view3d: View3D, lights: Light[]): void {
    const shadowPass = view3d.passByBit[RenderPassBit.SHADOW] as ShadowRenderPassGl;

    // Start the pass's shadow frame (advance the cadence clock + reset the slot
    // cursor) before the light loop. Runs every frame even when the pass is
    // culled, so the cadence tracks real frames.
    shadowPass?.beginFrame(view3d);

    const glData = getGlobalGlData(view3d, this._renderer);
    const globalUniforms = glData.globalUniformGroup.uniforms;
    const globalLightParams = globalUniforms.uGlobalLightParams as Float32Array;

    globalLightParams[0] = 0;
    globalLightParams[1] = 0;
    globalLightParams[2] = 0;

    // Hemisphere uniforms — only refreshed when env is a hemisphere object.
    // Under any other env kind the hemisphere bit isn't compiled into any
    // shader, so stale uniform values are unread and harmless.
    const environment = view3d.environment;
    if (environment !== null && !(environment instanceof CubeTexture)) {
      const hi = environment.intensity ?? 1;
      const hemisphereSky = globalUniforms.uHemisphereSky as Float32Array;
      const hemisphereGround = globalUniforms.uHemisphereGround as Float32Array;
      const hemisphereUp = globalUniforms.uHemisphereUp as Float32Array;

      writeLinearRgb(hemisphereSky, 0, scratchColor.setValue(environment.skyColor), hi);

      writeLinearRgb(hemisphereGround, 0, scratchColor.setValue(environment.groundColor), hi);

      const up = environment.up ?? HEMISPHERE_DEFAULT_UP;
      const lenSq = up.x * up.x + up.y * up.y + up.z * up.z;
      const invLen = lenSq > 0 ? 1 / Math.sqrt(lenSq) : 0;
      hemisphereUp[0] = up.x * invLen;
      hemisphereUp[1] = up.y * invLen;
      hemisphereUp[2] = up.z * invLen;
    }

    view3d._lightDataBuffer.reset();

    let lightCount = 0;

    for (let i = 0; i < lights.length; i++) {
      const light = lights[i];

      if (!light._worldVisible) continue;

      if (light.type === 'ambient') {
        addLinearRgb(globalLightParams, 0, light.color, light.intensity);
        continue;
      }

      if (lightCount >= MAX_LIGHTS) continue;

      // Claim, update, and upload this light's shadow — a no-op for non-casters
      // (which it also marks unshadowed). The pass owns the slot count.
      shadowPass?.prepareShadow(light, view3d);

      view3d._lightDataBuffer.add(light);
      lightCount++;
    }

    globalLightParams[3] = lightCount;

    const uLightData = globalUniforms.uLightData as Float32Array;
    uLightData.set(view3d._lightDataBuffer.data.subarray(0, lightCount * FLOATS_PER_LIGHT), 0);
  }
}

declare global {
  namespace PixiMixins {
    interface WebGLSystems {
      /** Per-frame light/shadow data packing for 3D scenes */
      lighting3d: LightingSystemGl;
    }
  }
}
