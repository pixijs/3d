import { RAD_TO_DEG } from 'pixi.js';

import type { Scene3DDescriptor } from '../../../Scene3DDescriptor';
import type { GltfFormat } from '../GltfFormat';
import { linearRgbToSrgb } from './processMaterials';

const lightMap: Record<string, number> = {
  directional: 0,
  point: 1,
  spot: 2,
};

/**
 * Converts `KHR_lights_punctual` lights into descriptor lights
 *
 * A spot's cone becomes a `coneAngle` of the outer angle in degrees and a `penumbra` of
 * `1 - inner / outer`, clamped to 0 to 1. A light with no `range` gets 0, which means infinite.
 * @param gltfRaw - Parsed glTF JSON
 * @param descriptor - Receives the light presets
 * @internal
 */
export function processLights(gltfRaw: GltfFormat, descriptor: Scene3DDescriptor): void {
  if (gltfRaw.extensions?.KHR_lights_punctual?.lights) {
    const lights = gltfRaw.extensions.KHR_lights_punctual.lights;

    descriptor.lights = lights.map((rawLight) => {
      const outerConeAngle = rawLight.spot?.outerConeAngle ?? Math.PI / 4;
      const innerConeAngle = rawLight.spot?.innerConeAngle ?? 0;

      return {
        name: rawLight.name,
        color: linearRgbToSrgb(rawLight.color ?? [1, 1, 1]),
        intensity: rawLight.intensity,
        type: lightMap[rawLight.type],
        range: rawLight.range ?? 0,
        coneAngle: outerConeAngle * RAD_TO_DEG,
        penumbra: outerConeAngle > 0 ? Math.max(0, Math.min(1, 1.0 - innerConeAngle / outerConeAngle)) : 0,
      };
    });
  }
}
