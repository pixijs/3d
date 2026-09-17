import type { BindGroup, UniformGroup } from 'pixi.js';

/**
 * What one renderer keeps on a View3D: the global uniform group, the group-0 bind group over
 * it, and the View's last-seen versions of the shared store buffers
 *
 * Lives at `view3d._gpuData[renderer.uid]`, minted by the first `execute` that draws the View
 * on that renderer (`getGlobalGpuData` / `getGlobalGlData`). It is also the View's payload in
 * pixi's renderer GC: pixi runs `destroy()` when the View unloads or the renderer is destroyed,
 * and clears the slot, so the next frame mints a fresh one.
 *
 * One class serves both backends. WebGL never realises the uniform buffer (its group syncs
 * through `uniform*` calls) and never compares the geometry store version, so both stay unused
 * there.
 * @internal
 */
export class View3DGlobalData {
  /** Camera, fog, light and time uniforms every 3D shader reads */
  public readonly globalUniformGroup: UniformGroup;

  /** Group 0 of every 3D shader: the uniforms above plus the frame's textures and stores */
  public readonly globalBindGroup: BindGroup;

  /**
   * Last-seen `bufferVersion` of each shared store, compared by `detectSharedCacheInvalidation`
   * to find a reallocation that leaves this View's cached draw state stale. `-1` forces the
   * first render to reconcile.
   */
  public lastMaterialStoreBufferVersion = -1;
  /** See {@link View3DGlobalData#lastMaterialStoreBufferVersion} */
  public lastAtlasBufferVersion = -1;
  /** See {@link View3DGlobalData#lastMaterialStoreBufferVersion} */
  public lastMorphStoreBufferVersion = -1;
  /** See {@link View3DGlobalData#lastMaterialStoreBufferVersion}; WebGPU only, GL re-binds the store's texture per frame */
  public lastGeometryStoreBufferVersion = -1;

  constructor(globalUniformGroup: UniformGroup, globalBindGroup: BindGroup) {
    this.globalUniformGroup = globalUniformGroup;
    this.globalBindGroup = globalBindGroup;
  }

  /**
   * Bind group first, so its slots let go of everything they bind before the uniform buffer
   * dies. The buffer exists only on WebGPU.
   */
  public destroy(): void {
    this.globalBindGroup.destroy();
    this.globalUniformGroup.buffer?.destroy();
  }
}
