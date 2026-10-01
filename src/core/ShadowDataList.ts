import { MAX_SHADOW_SLOTS } from './render-passes/shadow/shadowPassUtils';
import type { CascadeSlot } from './render-passes/shadow/shadowPassUtils';

/**
 * Floats per shadow slot in `uShadowData`: 6 × `vec4`
 * @internal
 */
export const FLOATS_PER_SHADOW_SLOT = 24;

/**
 * Packs one cascade slot into the list at `offset` (layout on `ShadowDataList`)
 * @param slot - The populated cascade slot
 * @param buffer - Shadow list data
 * @param offset - Float offset of the slot's entry
 */
function writeCascadeSlot(slot: CascadeSlot, buffer: Float32Array, offset: number): void {
  buffer.set(slot.cameraData.viewProjection.elements, offset);

  buffer[offset + 16] = slot.bias;
  buffer[offset + 17] = slot.normalBias;
  buffer[offset + 18] = slot.mapSize;
  buffer[offset + 19] = slot.cascadeCount;

  const splits = slot.splits;
  buffer[offset + 20] = splits?.[0] ?? 1e30;
  buffer[offset + 21] = splits?.[1] ?? 1e30;
  buffer[offset + 22] = splits?.[2] ?? 1e30;
  buffer[offset + 23] = splits?.[3] ?? 1e30;
}

/**
 * The view's packed list of shadow slots, rebuilt every frame
 *
 * One slot per (light, cascade). A light's cascade `c` sits at `light._shadowDataIndex + c`, the
 * index the list had when the shadow pass claimed the light's slots. `data` is the value of the
 * `uShadowData` uniform on both backends, so an added slot is already in the uniforms. The shadow
 * pass stops adding at `MAX_SHADOW_SLOTS`, so the array never grows.
 *
 * Layout (stride = 24 floats, 6 × `vec4`), the one source of truth for `uShadowData` on both
 * backends, unpacked by `shadowBitGl` and `shadowBitGpu`:
 * - [0..15]  light-space view-projection matrix
 * - [16]     bias
 * - [17]     normalBias
 * - [18]     map size
 * - [19]     cascadeCount
 * - [20..23] view-space split planes; an unused split is a large sentinel (not 0), so the
 *            branchless `step(splits, viewDepth)` cascade select never counts it as crossed
 * @internal
 */
export class ShadowDataList {
  /** Packed slots, `FLOATS_PER_SHADOW_SLOT` floats each; entries at and above `count` are stale */
  public readonly data = new Float32Array(MAX_SHADOW_SLOTS * FLOATS_PER_SHADOW_SLOT);
  private _count = 0;

  /** Slots added since the last `reset` */
  get count(): number {
    return this._count;
  }

  /** Clears the list for the next frame (does not clear memory) */
  public reset(): void {
    this._count = 0;
  }

  /**
   * Appends one slot to the list
   * @param slot - The populated cascade slot to pack
   */
  public add(slot: CascadeSlot): void {
    writeCascadeSlot(slot, this.data, this._count * FLOATS_PER_SHADOW_SLOT);
    this._count++;
  }
}
