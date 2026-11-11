import { Color } from 'pixi.js';

import { writeLinearRgb } from '../materials/BaseMaterial3D';
import { HEMISPHERE_DEFAULT_UP } from '../scene/lights/environment/Hemisphere';
import type { Hemisphere } from '../scene/lights/environment/Hemisphere';

/** One scratch per colour, since `Color` skips the parse when its source repeats */
const skyScratch = new Color();
const groundScratch = new Color();

/**
 * Writes a hemisphere's linear sky and ground colours, scaled by its intensity, and its unit up axis; every
 * reader goes through this, so the lighting and the background agree
 * @param hemisphere - The hemisphere.
 * @param sky - Receives the sky colour.
 * @param ground - Receives the ground colour.
 * @param up - Receives the up axis, zeros when it has no length.
 * @internal
 */
export function writeHemisphere(
  hemisphere: Hemisphere,
  sky: Float32Array,
  ground: Float32Array,
  up: Float32Array,
): void {
  const intensity = hemisphere.intensity ?? 1;
  writeLinearRgb(sky, 0, skyScratch.setValue(hemisphere.skyColor), intensity);
  writeLinearRgb(ground, 0, groundScratch.setValue(hemisphere.groundColor), intensity);

  const axis = hemisphere.up ?? HEMISPHERE_DEFAULT_UP;
  const lenSq = axis.x * axis.x + axis.y * axis.y + axis.z * axis.z;
  const invLen = lenSq > 0 ? 1 / Math.sqrt(lenSq) : 0;
  up[0] = axis.x * invLen;
  up[1] = axis.y * invLen;
  up[2] = axis.z * invLen;
}
