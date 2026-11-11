import { BigPool } from 'pixi.js';

import type { View3D } from '../../scene/View3D';
import type { Mesh3DBatch } from '../batcher/Mesh3DBatch';
import { CullResult } from './CullResult';

/**
 * Pooled {@link CullResult}s by batch uid, any number per batch. The owner hands them back with
 * {@link CullResults.release} when it goes, so no bundle outlives it bound to a freed survivor buffer.
 * @internal
 */
export class CullResults {
  private readonly _byBatch: Record<number, (CullResult | undefined)[]> = Object.create(null);
  private _lastMeshBatchesDirtyId = -1;

  public ensure(batch: Mesh3DBatch, index = 0): CullResult {
    const results = (this._byBatch[batch.uid] ??= []);
    return (results[index] ??= BigPool.get(CullResult));
  }

  /** Never mints; `undefined` means prepare never minted one, so there is nothing to draw */
  public get(batch: Mesh3DBatch, index = 0): CullResult | undefined {
    return this._byBatch[batch.uid]?.[index];
  }

  public remove(batch: Mesh3DBatch, index: number): void {
    const results = this._byBatch[batch.uid];
    const result = results?.[index];
    if (!results || !result) return;
    BigPool.return(result);
    results[index] = undefined;
    while (results.length > 0 && !results[results.length - 1]) results.pop();
  }

  /** Sweeps only when `View3D._meshBatchesDirtyId` has moved, so a steady frame costs one compare */
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

  public unload(): void {
    for (const key in this._byBatch) {
      for (const result of this._byBatch[key]) result?.unload();
    }
  }

  public release(): void {
    for (const key in this._byBatch) {
      for (const result of this._byBatch[key]) if (result) BigPool.return(result);
      delete this._byBatch[key];
    }
    this._lastMeshBatchesDirtyId = -1;
  }
}
