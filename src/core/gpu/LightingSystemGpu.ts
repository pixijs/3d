import { Color, CubeTexture, ExtensionType } from 'pixi.js';
import type { WebGPURenderer } from 'pixi.js';

import { addLinearRgb, writeLinearRgb } from '../../materials/BaseMaterial3D';
import type { AmbientLight } from '../../scene/lights/AmbientLight';
import { HEMISPHERE_DEFAULT_UP } from '../../scene/lights/environment/Hemisphere';
import type { Light } from '../../scene/lights/Light';
import { MAX_LIGHTS } from '../../scene/View3D';
import type { View3D } from '../../scene/View3D';
import { RenderPassBit } from '../render-passes/RenderPass';
import type { ShadowRenderPassBase } from '../render-passes/shadow/ShadowRenderPassBase';
import { getGlobalGpuData } from './shader/globalBitGpu';

/**
 * Manages lights, uploads their data to the GPU, and coordinates with the shadow pass to
 * compute shadow matrices
 *
 * Handles both single-layer and cascaded shadow maps via the view's shadow pass.
 *
 * Per frame, packs into the global uniform group:
 *   - Per-light data (directional / point / spot) into `view3d._lightDataList`, whose array is the `uLightData` uniform.
 *   - Ambient summed from any `AmbientLight` instances.
 *   - Hemisphere uniforms when `view3d.environment` is a hemisphere.
 *
 * Registered as a WebGPU renderer system (`renderer.lighting3d`).
 * @internal
 */
export class LightingSystemGpu {
  /** @ignore */
  public static extension = {
    type: [ExtensionType.WebGPUSystem],
    name: 'lighting3d',
  } as const;

  private readonly _renderer: WebGPURenderer;

  constructor(renderer: WebGPURenderer) {
    this._renderer = renderer;
  }

  /**
   * Pack this frame's light + shadow data into the view's global uniforms
   * @param view3d - The view whose global uniforms receive the packed data.
   * @param lights - The view's collected lights, in render order.
   */
  public update(view3d: View3D, lights: Light[]): void {
    const shadowPass = view3d.passByBit[RenderPassBit.SHADOW] as ShadowRenderPassBase | undefined;

    // Start the pass's shadow frame (advance the cadence clock + reset the slot
    // cursor) before the light loop. Runs every frame even when the pass is
    // culled, so the cadence tracks real frames.
    shadowPass?.beginFrame(view3d);

    const { _lightDataList: lightDataList, environment } = view3d;

    lightDataList.reset();

    const gpuData = getGlobalGpuData(view3d, this._renderer);
    const globalUniforms = gpuData.globalUniformGroup.uniforms;
    const globalLightParams = globalUniforms.uGlobalLightParams as Float32Array;

    globalLightParams[0] = 0;
    globalLightParams[1] = 0;
    globalLightParams[2] = 0;

    // Hemisphere uniforms — only refreshed when env is a hemisphere object.
    // Under any other env kind the hemisphere bit isn't compiled into any
    // shader, so stale uniform values are unread and harmless.
    if (environment !== null && !(environment instanceof CubeTexture)) {
      const hi = environment.intensity ?? 1;
      const hemisphereSky = globalUniforms.uHemisphereSky as Float32Array;
      const hemisphereGround = globalUniforms.uHemisphereGround as Float32Array;
      const hemisphereUp = globalUniforms.uHemisphereUp as Float32Array;

      const scratchColor = Color.shared;

      writeLinearRgb(hemisphereSky, 0, scratchColor.setValue(environment.skyColor), hi);

      writeLinearRgb(hemisphereGround, 0, scratchColor.setValue(environment.groundColor), hi);

      const up = environment.up ?? HEMISPHERE_DEFAULT_UP;
      const lenSq = up.x * up.x + up.y * up.y + up.z * up.z;
      const invLen = lenSq > 0 ? 1 / Math.sqrt(lenSq) : 0;
      hemisphereUp[0] = up.x * invLen;
      hemisphereUp[1] = up.y * invLen;
      hemisphereUp[2] = up.z * invLen;
    }

    for (let i = 0; i < lights.length; i++) {
      const light = lights[i];

      if (!light._worldVisible) continue;

      if (light.type === 'ambient') {
        const al = light as AmbientLight;
        const color = al.color;
        const intensity = al.intensity;

        addLinearRgb(globalLightParams, 0, color, intensity);
        continue;
      }

      if (lightDataList.count >= MAX_LIGHTS) continue;

      // Claim, update, and upload this light's shadow — a no-op for non-casters
      // (which it also marks unshadowed). The slots land in the view's shadow list.
      shadowPass?.prepareShadow(light, view3d);

      lightDataList.add(light);
    }

    globalLightParams[3] = lightDataList.count;
  }
}

declare global {
  namespace PixiMixins {
    interface WebGPUSystems {
      /** Per-frame light/shadow data packing for 3D scenes */
      lighting3d: LightingSystemGpu;
    }
  }
}
