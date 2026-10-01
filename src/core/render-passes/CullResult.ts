import { BigPool } from 'pixi.js';
import type { BindGroup, RenderBundle } from 'pixi.js';

import type { View3D } from '../../scene/View3D';
import type { Mesh3DBatch } from '../batcher/Mesh3DBatch';
import { IndirectDrawData } from '../buffers/IndirectDrawData';
import { RenderInstanceBuffer } from '../buffers/RenderInstanceBuffer';
import type { DrawList } from './DrawList';

/**
 * What one frustum decides about one {@link DrawList} on WebGPU: the instances that survive its
 * cull, the indirect counts they draw with, and the bundle recorded against both
 *
 * A pass owns one per batch it draws (the shadow pass one per batch per cascade, held on the
 * light). The draw list stays shared: this record holds nothing about *what* to draw, only
 * which of the list's instances and how many. A bundle bakes the survivor buffer and the args
 * buffer, so it lives here with them, and re-records when either reallocates
 * ({@link CullResult.sync}), the list's bundle counter moves, or the camera group
 * this draw will bind is not the one the bundle baked ({@link CullResult.isBundleStale}).
 *
 * Recycled through the global `BigPool`: {@link CullResult.reset} drops the bundle and the
 * watermarks and frees the GPU copies of both buffers, so a pooled result holds no GPU memory. Its
 * CPU arrays stay, so a reused result resizes them instead of allocating new ones.
 * @internal
 */
export class CullResult {
  /**
   * This frustum's surviving instances, `[storeIndex, packedTextureSlots]` per drawn instance,
   * written contiguously from each command's stable base
   *
   * Filled by the cull compute or the CPU walk and bound at the instance slot in the list's
   * instance buffer's place; never CPU-populated by anything else.
   */
  public readonly survivors = new RenderInstanceBuffer('survivors');

  /**
   * This frustum's indirect-draw args: the static lanes copied from the list's `drawData` on
   * {@link CullResult.sync}, the `instanceCount` lane rewritten each frame by the cull
   */
  public readonly indirectDrawData = new IndirectDrawData('survivorDrawCalls');

  /**
   * The bundle recorded against {@link survivors} and {@link indirectDrawData}, or `null` when
   * nothing valid is recorded (never recorded, dropped by a sync, or an immediate-replay pass
   * that records none)
   */
  public bundle: RenderBundle | null = null;

  /** `DrawList.commandList.dirtyId` this result last synced its lanes and survivor size to */
  public lastCommandListDirtyId = -1;

  /** `DrawList.gpuData.bundleDirtyId` the current {@link bundle} was recorded from */
  public lastBundleDirtyId = -1;

  /** The camera group the current {@link bundle} baked at group 1, or `null` when none is recorded */
  public lastCameraBindGroup: BindGroup | null = null;

  /**
   * Last `Mesh3DBatch._visibilityDirtyId` the visibility-only walk into this result consumed
   *
   * `-1` forces the walk on first use and after every sync; a mismatch means visibility
   * changed since, so the visibility-only callers re-run it (frustum producers run every
   * frame regardless — the camera has no change signal).
   */
  public lastVisibilityDirtyId = -1;

  /**
   * Re-syncs to the list's current draw program if it rebuilt since the last sync: copies the
   * command lanes (a fresh copy carries the batcher's full counts, so a cull that hasn't run yet
   * draws conservatively, never wrongly), sizes the survivors to the list, and drops the bundle,
   * since either buffer may have reallocated under it
   *
   * Steady frames reduce to one integer compare.
   * @param list - The draw list this result culls
   * @returns Whether a re-sync happened
   */
  public sync(list: DrawList): boolean {
    const dirtyId = list.commandList.dirtyId;
    if (this.lastCommandListDirtyId === dirtyId) return false;

    this.indirectDrawData.copyCommandsFrom(list.drawData, list.commandList.count);
    this.survivors.ensureSize(list.view.count);
    this.bundle = null;
    this.lastCommandListDirtyId = dirtyId;
    this.lastVisibilityDirtyId = -1;
    return true;
  }

  /**
   * Whether the recorded bundle is stale against the list's bundle counter or the camera
   * group this draw will bind
   *
   * Pure — see `DrawList.isDrawStale`.
   * @param list - The draw list the bundle replays
   * @param cameraBindGroup - The camera group this draw will bind at 1
   * @returns Whether the bundle must be re-recorded
   */
  public isBundleStale(list: DrawList, cameraBindGroup: BindGroup): boolean {
    return this.lastBundleDirtyId !== list.gpuData.bundleDirtyId || this.lastCameraBindGroup !== cameraBindGroup;
  }

  /**
   * Claims the bundle watermarks after (re)recording this result's bundle
   * @param list - The draw list the bundle replays
   * @param cameraBindGroup - The camera group the bundle baked at 1
   */
  public claimBundleRecorded(list: DrawList, cameraBindGroup: BindGroup): void {
    this.lastBundleDirtyId = list.gpuData.bundleDirtyId;
    this.lastCameraBindGroup = cameraBindGroup;
  }

  /**
   * Gives back what this result holds on the GPU — the bundle and the GPU copies of the survivor
   * and args buffers — keeping the CPU arrays so a reuse resizes rather than reallocates
   *
   * Every watermark is forgotten too, so the next use re-syncs to its list, re-fills and
   * re-records. Idempotent. The owner's `unload` path, and the `BigPool` return hook through
   * {@link CullResult.reset}: a pooled result holds no GPU memory.
   */
  public unload(): void {
    this.bundle = null;
    this.lastCommandListDirtyId = -1;
    this.lastBundleDirtyId = -1;
    this.lastCameraBindGroup = null;
    this.lastVisibilityDirtyId = -1;
    this.survivors.unload();
    this.indirectDrawData.unload();
  }

  /** `BigPool` return hook — see {@link CullResult.unload} */
  public reset(): void {
    this.unload();
  }

  /** `BigPool` teardown hook (`BigPool.clear`): free the owned GPU buffers */
  public destroy(): void {
    this.bundle = null;
    this.survivors.destroy();
    this.indirectDrawData.destroy();
  }
}

/**
 * The {@link CullResult}s one owner holds, keyed by batch uid, any number per batch
 *
 * A forward pass holds one per batch; the shadow pass holds one per batch per cascade, on the
 * light. Results are minted from the global `BigPool` on first use and returned to it when the
 * batch leaves the view ({@link CullResults.removeDetached}), when the owner drops one
 * ({@link CullResults.remove}), or when the owner goes ({@link CullResults.release}) — so a
 * bundle can never outlive its owner bound to a freed survivor buffer.
 * @internal
 */
export class CullResults {
  private readonly _byBatch: Record<number, (CullResult | undefined)[]> = Object.create(null);
  /** `View3D._meshBatchesDirtyId` at the last `removeDetached` — gates the sweep to batch-list changes */
  private _lastMeshBatchesDirtyId = -1;

  /**
   * The result for `batch` at `index`, minted from the pool on first use
   * @param batch - The batch the result culls
   * @param index - Which of the owner's results per batch (a cascade index for shadows)
   * @returns The result
   */
  public ensure(batch: Mesh3DBatch, index = 0): CullResult {
    const results = (this._byBatch[batch.uid] ??= []);
    return (results[index] ??= BigPool.get(CullResult));
  }

  /**
   * The result for `batch` at `index` if one has been minted, else `undefined`
   *
   * For the render phase, where a missing result means prepare skipped the pair this frame —
   * nothing staged, nothing to draw.
   * @param batch - The batch the result culls
   * @param index - Which of the owner's results per batch
   * @returns The result, or `undefined`
   */
  public get(batch: Mesh3DBatch, index = 0): CullResult | undefined {
    return this._byBatch[batch.uid]?.[index];
  }

  /**
   * Returns the result for `batch` at `index` to the pool, if one was minted
   *
   * Results are minted per index, so the array can have holes; it is trimmed back to its last
   * live result.
   * @param batch - The batch the result culls
   * @param index - Which of the owner's results per batch
   */
  public remove(batch: Mesh3DBatch, index: number): void {
    const results = this._byBatch[batch.uid];
    const result = results?.[index];
    if (!results || !result) return;
    BigPool.return(result);
    results[index] = undefined;
    while (results.length > 0 && !results[results.length - 1]) results.pop();
  }

  /**
   * Returns the results of batches the view has detached to the pool
   *
   * Runs only on frames where the view's batch list actually changed (e.g. a removed
   * `BatchedMesh3D`); a steady frame is one integer compare.
   * @param view3d - The view whose live batch list is the reference
   */
  public removeDetached(view3d: View3D): void {
    const dirtyId = view3d._meshBatchesDirtyId;
    if (this._lastMeshBatchesDirtyId === dirtyId) return;
    this._lastMeshBatchesDirtyId = dirtyId;

    const batches = view3d._meshBatches;
    for (const key in this._byBatch) {
      const uid = +key;
      let present = false;
      for (let i = 0; i < batches.length; i++) {
        if (batches[i].uid === uid) {
          present = true;
          break;
        }
      }
      if (present) continue;
      for (const result of this._byBatch[uid]) if (result) BigPool.return(result);
      delete this._byBatch[uid];
    }
  }

  /**
   * Gives back the GPU memory of every result, keeping them minted for the owner's next frame
   * @see {@link CullResult.unload}
   */
  public unload(): void {
    for (const key in this._byBatch) {
      for (const result of this._byBatch[key]) result?.unload();
    }
  }

  /** Returns every result to the pool; the owner is going away */
  public release(): void {
    for (const key in this._byBatch) {
      for (const result of this._byBatch[key]) if (result) BigPool.return(result);
      delete this._byBatch[key];
    }
    this._lastMeshBatchesDirtyId = -1;
  }
}
