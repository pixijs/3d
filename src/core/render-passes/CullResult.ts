import type { BindGroup, RenderBundle } from 'pixi.js';

import { IndirectDrawData } from '../buffers/IndirectDrawData';
import { RenderInstanceBuffer } from '../buffers/RenderInstanceBuffer';
import type { DrawList } from './DrawList';

/**
 * What one camera's cull decides about one {@link DrawList} on WebGPU, and the bundle recorded against it
 * @internal
 */
export class CullResult {
  public readonly survivors = new RenderInstanceBuffer('survivors');

  /** A copy of the list's `drawData`, re-taken on {@link sync}; the cull writes its instance counts */
  public readonly indirectDrawData = new IndirectDrawData('survivorDrawCalls');

  public bundle: RenderBundle | null = null;

  /** Whether the pass issues direct draws from CPU-side counts rather than indirect ones; set by {@link sync} */
  public direct = false;

  /** Bumped by the CPU walk in `gpu/cull.ts` when a count changes; a bundle of direct draws bakes the counts */
  public countsDirtyId = 0;

  public lastBundleCountsDirtyId = -1;
  public lastCommandListDirtyId = -1;
  public lastRangesDirtyId = -1;
  public lastBundleDirtyId = -1;
  public lastCameraBindGroup: BindGroup | null = null;

  /** `-1` makes `gpu/cull.ts` run the visibility compaction again */
  public lastVisibilityDirtyId = -1;

  /**
   * Re-syncs to the list's commands after a rebuild or an edit, and to `direct`
   *
   * An edit keeps an indirect bundle, which holds the body's commands by their place in the args.
   * @returns Whether it re-synced
   */
  public sync(list: DrawList, direct: boolean): boolean {
    if (this.direct !== direct) {
      this.direct = direct;
      this.bundle = null;
      this.lastVisibilityDirtyId = -1;
    }

    const dirtyId = list.commandList.dirtyId;
    const rangesDirtyId = list.rangesDirtyId;
    if (this.lastCommandListDirtyId === dirtyId && this.lastRangesDirtyId === rangesDirtyId) return false;

    const editedOnly = this.lastCommandListDirtyId === dirtyId;
    const args = this.indirectDrawData.drawCalls;
    const survivors = this.survivors.data;
    this.indirectDrawData.copyCommandsFrom(list.drawData, list.commandList.count);
    this.survivors.ensureSize(list.view.count);
    if (!editedOnly || this.direct || args !== this.indirectDrawData.drawCalls || survivors !== this.survivors.data) {
      this.bundle = null;
    }
    this.lastCommandListDirtyId = dirtyId;
    this.lastRangesDirtyId = rangesDirtyId;
    this.lastVisibilityDirtyId = -1;
    return true;
  }

  /** Whether the recorded bundle must re-record */
  public isBundleStale(list: DrawList, cameraBindGroup: BindGroup): boolean {
    return (
      this.lastBundleDirtyId !== list.gpuData.bundleDirtyId ||
      this.lastCameraBindGroup !== cameraBindGroup ||
      (this.direct && this.lastBundleCountsDirtyId !== this.countsDirtyId)
    );
  }

  /** Claims the bundle watermarks after recording this result's bundle */
  public claimBundleRecorded(list: DrawList, cameraBindGroup: BindGroup): void {
    this.lastBundleDirtyId = list.gpuData.bundleDirtyId;
    this.lastCameraBindGroup = cameraBindGroup;
    this.lastBundleCountsDirtyId = this.countsDirtyId;
  }

  /** Frees the bundle and the buffers' GPU copies, keeping the CPU arrays; the next use re-syncs */
  public unload(): void {
    this.bundle = null;
    this.lastCommandListDirtyId = -1;
    this.lastRangesDirtyId = -1;
    this.lastBundleDirtyId = -1;
    this.lastCameraBindGroup = null;
    this.lastBundleCountsDirtyId = -1;
    this.lastVisibilityDirtyId = -1;
    this.survivors.unload();
    this.indirectDrawData.unload();
  }

  /** `BigPool` return hook: a pooled result holds no GPU memory */
  public reset(): void {
    this.unload();
  }

  /** `BigPool.clear` hook */
  public destroy(): void {
    this.bundle = null;
    this.survivors.destroy();
    this.indirectDrawData.destroy();
  }
}
