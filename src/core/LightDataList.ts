import { DEG_TO_RAD } from 'pixi.js';

import { writeLinearRgb } from '../materials/BaseMaterial3D';
import type { TypedFixedArray } from '../math/utils/misc';
import type { Light } from '../scene/lights/Light';
import type { PointLight } from '../scene/lights/PointLight';
import type { SpotLight } from '../scene/lights/SpotLight';
import { FLOATS_PER_LIGHT, MAX_LIGHTS } from '../scene/View3D';
import { cascadeCountFor } from './render-passes/shadow/shadowPassUtils';

/**
 * Writes the light's normalized forward direction (the -Z basis vector of its
 * world matrix) into the buffer at `[offset+8..10]`
 *
 * Pre-normalizing on the CPU lets the fragment shader skip a per-fragment
 * `normalize()`. Rotation matrices are already orthonormal, but a parent
 * transform with non-uniform scale would denormalize the basis vector — so
 * we normalize defensively here.
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

  // Colour (display-space, like every ColorSource) decoded to linear light
  // and pre-multiplied by intensity. Decode-at-pack: MAX_LIGHTS-bounded, so
  // the per-frame pow cost is noise.
  writeLinearRgb(buffer, offset + 4, light.color, light.intensity);

  if (light.type === 'directional') {
    buffer[offset + 3] = 0;
    buffer[offset + 7] = 0; // No range

    writeNormalizedDirection(buffer, offset, elements);
  } else if (light.type === 'point') {
    buffer[offset + 3] = 1;
    buffer[offset + 7] = (light as PointLight).range;
  } else if (light.type === 'spot') {
    buffer[offset + 3] = 2;
    const spot = light as SpotLight;
    buffer[offset + 7] = spot.range;

    writeNormalizedDirection(buffer, offset, elements);

    // [11] = outer cone cosine (light vanishes beyond this),
    // [12] = inner cone cosine (full intensity inside this).
    // penumbra=0 collapses inner onto outer → hard edge.
    const coneAngle = spot.coneAngle * DEG_TO_RAD;

    buffer[offset + 11] = Math.cos(coneAngle);
    buffer[offset + 12] = Math.cos(coneAngle * (1 - spot.penumbra));
  }

  buffer[offset + 13] = light._shadowDataIndex;
  // Cascade count the shader selects against. Sourced from the shared
  // `cascadeCountFor` (1 for single-map lights, 2-MAX_CASCADES for CSM) so a
  // spot / fixed-area light with `shadow.cascades` set never enters the CSM
  // branch and reads a slot it never claimed.
  buffer[offset + 14] = cascadeCountFor(light);
};

/**
 * The view's packed list of *non-ambient* lights, rebuilt every frame
 *
 * `data` is the value of the `uLightData` uniform on both backends, so a packed light is already
 * in the uniforms: the light loop walks it for `i in [0..lightCount)`, and the tile binner reads
 * the same array.
 * The capacity is fixed. The lighting systems stop at `MAX_LIGHTS`, and `add` does not
 * bounds-check. The array is never reallocated, so each backend's uniform group can hold it by
 * reference. Writing here does not mark that group dirty; the pipe's per-frame
 * `globalUniformGroup.update()` does the upload.
 *
 * Layout (stride = 16 floats):
 * - [0..2]   world position (x,y,z)
 * - [3]      light type (0=dir, 1=point, 2=spot)
 * - [4..6]   rgb * intensity
 * - [7]      range (0 for directional)
 * - [8..10]  direction (for dir/spot, pre-normalized — shader can skip `normalize()`)
 * - [11]     spot outer coneCos (edge of cone; light vanishes here)
 * - [12]     spot inner coneCos (full intensity inside; == [11] when penumbra=0)
 * - [13]     shadowDataIndex (-1 if no shadows)
 * - [14]     cascadeCount (1 = single map, 2-4 = CSM)
 * - [15]     reserved / future expansion
 *
 * Note: `shadowDataIndex` must correspond to the slot the shadow pass wrote into `uShadowData`
 * for the same frame.
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
