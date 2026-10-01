import type { BindGroup, UniformData } from 'pixi.js';

import type { GlobalUniformGroup } from '../core/GlobalUniformGroup';

/**
 * What one renderer keeps on a View3D: the global uniform group, the group-0 bind group over
 * it, and the view's last-seen versions of the shared store buffers
 *
 * Lives at `view3d._gpuData[renderer.uid]`, made by the first `execute` that draws the view on
 * that renderer (`getGlobalGpuData` or `getGlobalGlData`). It is also the view's payload in
 * pixi's renderer GC: pixi runs `destroy()` when the view unloads or the renderer is destroyed,
 * and clears the slot, so the next frame makes a fresh one.
 *
 * One class serves both backends. WebGL never realises the uniform buffer (its group syncs
 * through `uniform*` calls) and never compares the geometry store version, so both stay unused
 * there.
 * @internal
 */
export class View3DGlobalData<TExtra extends Record<string, UniformData> = Record<never, UniformData>> {
  /** Light, shadow, fog, exposure, environment and time uniforms; the camera has its own group */
  public readonly globalUniformGroup: GlobalUniformGroup<TExtra>;

  /** Group 0 of every 3D shader: the uniforms above plus the frame's textures and stores */
  public readonly globalBindGroup: BindGroup;

  /**
   * Last-seen `bufferVersion` of each shared store, compared by `detectSharedCacheInvalidation`
   * to find a reallocation that leaves this view's cached draw state stale. `-1` forces the
   * first render to reconcile.
   */
  public lastMaterialStoreBufferVersion = -1;
  /** See {@link View3DGlobalData#lastMaterialStoreBufferVersion} */
  public lastAtlasBufferVersion = -1;
  /** See {@link View3DGlobalData#lastMaterialStoreBufferVersion} */
  public lastMorphStoreBufferVersion = -1;
  /** See {@link View3DGlobalData#lastMaterialStoreBufferVersion}; WebGPU only, GL re-binds the store's texture per frame */
  public lastGeometryStoreBufferVersion = -1;

  constructor(globalUniformGroup: GlobalUniformGroup<TExtra>, globalBindGroup: BindGroup) {
    this.globalUniformGroup = globalUniformGroup;
    this.globalBindGroup = globalBindGroup;
  }

  /**
   * Destroys the bind group, then the uniform buffer, so the group's slots let go of everything
   * they bind before the buffer dies; the buffer exists only on WebGPU
   */
  public destroy(): void {
    this.globalBindGroup.destroy();
    this.globalUniformGroup.buffer?.destroy();
  }
}
