import { DEG_TO_RAD } from 'pixi.js';

import { writeLinearRgb } from '../materials/BaseMaterial3D';
import type { TypedFixedArray } from '../math/utils/misc';
import type { Light } from '../scene/lights/Light';
import type { PointLight } from '../scene/lights/PointLight';
import type { SpotLight } from '../scene/lights/SpotLight';
import { FLOATS_PER_LIGHT, MAX_LIGHTS } from '../scene/View3D';
import { cascadeCountFor } from './render-passes/shadow/shadowPassUtils';

/**
 * Writes the light's normalized forward direction (the -Z basis vector of its world matrix) into
 * the buffer at `[offset+8..10]`
 *
 * Pre-normalizing on the CPU lets the fragment shader skip a per-fragment `normalize()`. Any scale
 * on the light or its parents stretches the basis vector, which is why it is normalized here.
 * @param buffer - Light list data
 * @param offset - Float offset of the light's entry
 * @param elements - The light's world matrix
 */
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
 * Packs one light into the list at `offset` (layout on `LightDataList`)
 *
 * The colour is display space, like every `ColorSource`, so it is decoded to linear light here
 * and premultiplied by the intensity. Decoding at pack time costs a `pow` per channel, which is
 * noise for at most `MAX_LIGHTS` lights a frame. The cascade count comes from `cascadeCountFor`,
 * the count the shadow passes claim slots by, so the shader never selects a cascade slot the light
 * didn't claim.
 *
 * Exposed for the colour-space round-trip test.
 * @param light - The light to pack
 * @param buffer - Light list data
 * @param offset - Float offset of the light's entry
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
    buffer[offset + 7] = (light as PointLight).range;
  } else if (light.type === 'spot') {
    buffer[offset + 3] = 2;
    const spot = light as SpotLight;
    buffer[offset + 7] = spot.range;

    writeNormalizedDirection(buffer, offset, elements);

    const coneAngle = spot.coneAngle * DEG_TO_RAD;

    buffer[offset + 11] = Math.cos(coneAngle);
    buffer[offset + 12] = Math.cos(coneAngle * (1 - spot.penumbra));
  }

  buffer[offset + 13] = light._shadowDataIndex;
  buffer[offset + 14] = cascadeCountFor(light);
};

/**
 * The view's packed list of *non-ambient* lights, rebuilt every frame
 *
 * `data` is the value of the `uLightData` uniform on both backends, so a packed light is already
 * in the uniforms. The shader's light loop reads the entries whose bits the camera's tile and
 * depth masks set, and the tile binner (`binLightTiles`) reads the same array.
 *
 * The capacity is fixed. The lighting systems stop at `MAX_LIGHTS`, and `add` does not
 * bounds-check. The array is never reallocated, so each backend's uniform group can hold it by
 * reference. Writing here does not mark that group dirty; the pipe's per-frame
 * `globalUniformGroup.update()` does the upload.
 *
 * Layout (stride `FLOATS_PER_LIGHT` = 16 floats), unpacked by `createLightingBit` on both backends:
 * - [0..2]   world position (x,y,z)
 * - [3]      light type (0=dir, 1=point, 2=spot)
 * - [4..6]   linear rgb * intensity
 * - [7]      range (0 for directional, and for a point or spot light with no range)
 * - [8..10]  direction for dir/spot, pre-normalized so the shader can skip `normalize()`
 * - [11]     spot outer cone cosine: the light vanishes beyond it
 * - [12]     spot inner cone cosine: full intensity inside it; equals [11] when `penumbra` is 0
 * - [13]     the light's slot in `uShadowData` this frame, -1 if it casts no shadow; the lighting
 *            systems run the shadow pass's `prepareShadow` before `add` so the slot is current
 * - [14]     cascade count (1 = single map, 2-4 = CSM); WebGL's shader reads its copy from the
 *            shadow data instead
 * - [15]     unused
 * @internal
 */
export class LightDataList {
  /** Packed lights, `FLOATS_PER_LIGHT` floats each; entries at and above `count` are stale */
  public readonly data = new Float32Array(MAX_LIGHTS * FLOATS_PER_LIGHT);
  private _count = 0;

  /** Lights added since the last `reset` */
  get count(): number {
    return this._count;
  }

  /** Clears the list for the next frame (does not clear memory) */
  public reset(): void {
    this._count = 0;
  }

  /**
   * Appends one light to the list
   * @param light - The light to pack
   */
  public add(light: Light): void {
    writeLight(light, this.data, this._count * FLOATS_PER_LIGHT);
    this._count++;
  }
}
