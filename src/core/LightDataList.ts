import { DEG_TO_RAD } from 'pixi.js';

import { writeLinearRgb } from '../materials/BaseMaterial3D';
import type { TypedFixedArray } from '../math/utils/misc';
import type { Light } from '../scene/lights/Light';
import type { PointLight } from '../scene/lights/PointLight';
import type { SpotLight } from '../scene/lights/SpotLight';
import { FLOATS_PER_LIGHT, MAX_LIGHTS } from './lightLimits';
import { cascadeCountFor } from './render-passes/shadow/shadowPassUtils';

/** Smallest radius a light packs, which `PointLight.radius` in `PointLight.ts` states */
const MIN_LIGHT_RADIUS = 0.01;

const rangeSquared = (range: number): number => (range > 0 ? range * range : 0);

const radiusToFourth = (radius: number): number => {
  const r = radius > MIN_LIGHT_RADIUS ? radius : MIN_LIGHT_RADIUS;
  const rSq = r * r;
  return rSq * rSq;
};

/** Writes the light's unit forward direction, which the shader reads without normalizing */
const writeNormalizedDirection = (buffer: Float32Array, offset: number, elements: TypedFixedArray<16>) => {
  const dx = -elements[8];
  const dy = -elements[9];
  const dz = -elements[10];
  const invLen = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);
  buffer[offset + 8] = dx * invLen;
  buffer[offset + 9] = dy * invLen;
  buffer[offset + 10] = dz * invLen;
};

/**
 * Packs one light at `offset`, in the layout `LightStructGpu` and `LightStructGl` in `shaderStructs.ts` mirror,
 * with the shadow slots `prepareShadow` claimed for it, so that must run first
 * @internal
 */
export const writeLight = (light: Light, buffer: Float32Array, offset: number) => {
  const worldTransform = light.worldTransform;
  const elements = worldTransform.elements;

  buffer[offset] = elements[12];
  buffer[offset + 1] = elements[13];
  buffer[offset + 2] = elements[14];

  writeLinearRgb(buffer, offset + 4, light.color, light.intensity);

  if (light.type === 'directional') {
    buffer[offset + 3] = 0;
    buffer[offset + 7] = 0;

    writeNormalizedDirection(buffer, offset, elements);
  } else if (light.type === 'point') {
    buffer[offset + 3] = 1;
    const point = light as PointLight;
    buffer[offset + 7] = rangeSquared(point.range);
    buffer[offset + 15] = radiusToFourth(point.radius);
  } else if (light.type === 'spot') {
    buffer[offset + 3] = 2;
    const spot = light as SpotLight;
    buffer[offset + 7] = rangeSquared(spot.range);
    buffer[offset + 15] = radiusToFourth(spot.radius);

    writeNormalizedDirection(buffer, offset, elements);

    const coneAngle = spot.coneAngle * DEG_TO_RAD;

    buffer[offset + 11] = Math.cos(coneAngle);
    buffer[offset + 12] = Math.cos(coneAngle * (1 - spot.penumbra));
  }

  buffer[offset + 13] = light._shadowDataIndex;
  buffer[offset + 14] = cascadeCountFor(light);
};

/**
 * The view's non-ambient lights, `FLOATS_PER_LIGHT` floats each as `writeLight` packs them; `data` is `uLightData`'s
 * value on both backends, so it never reallocates, and `add` doesn't bounds-check: callers stop at `MAX_LIGHTS`
 * @internal
 */
export class LightDataList {
  /** Entries at and above `count` are stale */
  public readonly data = new Float32Array(MAX_LIGHTS * FLOATS_PER_LIGHT);
  private _count = 0;

  get count(): number {
    return this._count;
  }

  public reset(): void {
    this._count = 0;
  }

  public add(light: Light): void {
    writeLight(light, this.data, this._count * FLOATS_PER_LIGHT);
    this._count++;
  }
}
