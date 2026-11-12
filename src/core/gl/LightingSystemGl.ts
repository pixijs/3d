import { CubeTexture, ExtensionType } from 'pixi.js';
import type { WebGLRenderer } from 'pixi.js';

import { addLinearRgb } from '../../materials/BaseMaterial3D';
import type { Light } from '../../scene/lights/Light';
import type { View3D } from '../../scene/View3D';
import { MAX_LIGHTS } from '../lightLimits';
import { RenderPassBit } from '../render-passes/RenderPass';
import type { ShadowRenderPassBase } from '../render-passes/shadow/ShadowRenderPassBase';
import { writeHemisphere } from '../writeHemisphere';
import { getGlobalGlData } from './shader/globalBitGl';

/** @internal */
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
   * Runs the shadow pass's `beginFrame` every frame, then `prepareShadow` on each light before packing it, so the
   * light's shadow slot index is current when written
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
      /** Packs each frame's lights and shadows into a 3D view's global uniforms */
      lighting3d: LightingSystemGl;
    }
  }
}
