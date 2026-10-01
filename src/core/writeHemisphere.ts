import { Color } from 'pixi.js';

import { writeLinearRgb } from '../materials/BaseMaterial3D';
import { HEMISPHERE_DEFAULT_UP } from '../scene/lights/environment/Hemisphere';
import type { Hemisphere } from '../scene/lights/environment/Hemisphere';

/**
 * Scratch for parsing the sky colour
 *
 * Each colour gets its own: `Color` skips the parse when its source equals the last one it saw,
 * and a single instance alternating between sky and ground would never match.
 */
const skyScratch = new Color();
/** Scratch for parsing the ground colour; see `skyScratch` */
const groundScratch = new Color();

/**
 * Writes a hemisphere's three shader inputs: linear sky colour, linear ground colour, unit up axis
 *
 * Decodes the colours from sRGB and scales them by `intensity`. Normalises `up`, and writes zeros
 * for a zero-length one. Every reader uses this one conversion, so the lighting systems' global
 * `uHemisphere*` uniforms and the background pass's gradient agree on the same object.
 * @param hemisphere - The hemisphere to read
 * @param sky - Receives the linear sky colour
 * @param ground - Receives the linear ground colour
 * @param up - Receives the unit up axis
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
