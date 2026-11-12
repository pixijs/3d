import { CubeTexture, ExtensionType } from 'pixi.js';
import type { WebGPURenderer } from 'pixi.js';

import { addLinearRgb } from '../../materials/BaseMaterial3D';
import type { AmbientLight } from '../../scene/lights/AmbientLight';
import type { Light } from '../../scene/lights/Light';
import type { View3D } from '../../scene/View3D';
import { MAX_LIGHTS } from '../lightLimits';
import { RenderPassBit } from '../render-passes/RenderPass';
import type { ShadowRenderPassBase } from '../render-passes/shadow/ShadowRenderPassBase';
import { writeHemisphere } from '../writeHemisphere';
import { getGlobalGpuData } from './shader/globalBitGpu';

/** @internal */
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

  /** Calls the shadow pass's `beginFrame` first, every frame, even when the pass is culled */
  public update(view3d: View3D, lights: Light[]): void {
    const shadowPass = view3d.passByBit[RenderPassBit.SHADOW] as ShadowRenderPassBase | undefined;

    shadowPass?.beginFrame(view3d);

    const { _lightDataList: lightDataList, environment } = view3d;

    lightDataList.reset();

    const gpuData = getGlobalGpuData(view3d, this._renderer);
    const globalUniforms = gpuData.globalUniformGroup.uniforms;
    const globalLightParams = globalUniforms.uGlobalLightParams;

    globalLightParams[0] = 0;
    globalLightParams[1] = 0;
    globalLightParams[2] = 0;

    if (environment !== null && !(environment instanceof CubeTexture)) {
      writeHemisphere(
        environment,
        globalUniforms.uHemisphereSky,
        globalUniforms.uHemisphereGround,
        globalUniforms.uHemisphereUp,
      );
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

      shadowPass?.prepareShadow(light, view3d);

      lightDataList.add(light);
    }

    globalLightParams[3] = lightDataList.count;
  }
}

declare global {
  namespace PixiMixins {
    interface WebGPUSystems {
      /** Packs each 3D view's lights and shadows for its shaders, on every frame the view draws */
      lighting3d: LightingSystemGpu;
    }
  }
}
