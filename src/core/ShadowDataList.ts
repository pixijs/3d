import { MAX_SHADOW_SLOTS } from './render-passes/shadow/shadowPassUtils';
import type { CascadeSlot } from './render-passes/shadow/shadowPassUtils';

const FLOATS_PER_SHADOW_SLOT = 24;

/**
 * Packs one slot at `offset`, in the layout `ShadowDataStructGl` and `shadowBitsGpu` read; an unused split is 1e30,
 * not 0, so the shaders' `step(splits, viewDepth)` never counts it as crossed
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
 * The view's shadow slots, one per light and cascade, with a light's cascade `c` at `light._shadowDataIndex + c`;
 * `data` is `uShadowData`'s value on both backends, so it never reallocates, and `add` doesn't bounds-check:
 * `_claimShadowSlots` stops at `MAX_SHADOW_SLOTS`
 * @internal
 */
export class ShadowDataList {
  /** Entries at and above `count` are stale */
  public readonly data = new Float32Array(MAX_SHADOW_SLOTS * FLOATS_PER_SHADOW_SLOT);
  private _count = 0;

  get count(): number {
    return this._count;
  }

  public reset(): void {
    this._count = 0;
  }

  public add(slot: CascadeSlot): void {
    writeCascadeSlot(slot, this.data, this._count * FLOATS_PER_SHADOW_SLOT);
    this._count++;
  }
}
