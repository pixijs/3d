import { CubeTexture, ExtensionType } from 'pixi.js';
import type { WebGLRenderer } from 'pixi.js';

import { addLinearRgb } from '../../materials/BaseMaterial3D';
import type { Light } from '../../scene/lights/Light';
import { MAX_LIGHTS } from '../../scene/View3D';
import type { View3D } from '../../scene/View3D';
import { RenderPassBit } from '../render-passes/RenderPass';
import type { ShadowRenderPassBase } from '../render-passes/shadow/ShadowRenderPassBase';
import { writeHemisphere } from '../writeHemisphere';
import { getGlobalGlData } from './shader/globalBitGl';

/**
 * WebGL counterpart to `LightingSystemGpu`
 *
 * Packs light data into the global uniforms and coordinates with the shadow pass to compute
 * shadow matrices.
 *
 * Per-frame, packs into the global uniform group:
 *   - Per-light data (directional / point / spot) into `view3d._lightDataList`, whose array is the `uLightData` uniform.
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
   *
   * Calls the shadow pass's `beginFrame` before the light loop, every frame even when the pass is
   * culled. Each light up to `MAX_LIGHTS` then goes through `prepareShadow` before it's packed, so
   * its shadow slot index is current when written; lights past the cap are skipped.
   *
   * The hemisphere uniforms are written only while the environment is a `Hemisphere`; under any
   * other environment no compiled shader reads them, so stale values are harmless.
   * @param view3d - The view whose global uniforms receive the packed data
   * @param lights - The frame's visible-scene light list
   */
  public update(view3d: View3D, lights: Light[]): void {
    const shadowPass = view3d.passByBit[RenderPassBit.SHADOW] as ShadowRenderPassBase | undefined;

    shadowPass?.beginFrame(view3d);

    const glData = getGlobalGlData(view3d, this._renderer);
    const globalUniforms = glData.globalUniformGroup.uniforms;
    const globalLightParams = globalUniforms.uGlobalLightParams;

    globalLightParams[0] = 0;
    globalLightParams[1] = 0;
    globalLightParams[2] = 0;

    const environment = view3d.environment;
    if (environment !== null && !(environment instanceof CubeTexture)) {
      writeHemisphere(
        environment,
        globalUniforms.uHemisphereSky,
        globalUniforms.uHemisphereGround,
        globalUniforms.uHemisphereUp,
      );
    }

    const lightDataList = view3d._lightDataList;

    lightDataList.reset();

    for (let i = 0; i < lights.length; i++) {
      const light = lights[i];

      if (!light._worldVisible) continue;

      if (light.type === 'ambient') {
        addLinearRgb(globalLightParams, 0, light.color, light.intensity);
        continue;
      }

      if (lightDataList.count >= MAX_LIGHTS) continue;

      shadowPass?.prepareShadow(light, view3d);

      lightDataList.add(light);
    }

    globalLightParams[3] = lightDataList.count;
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
