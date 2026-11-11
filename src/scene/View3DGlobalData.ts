import type { BindGroup, UniformData } from 'pixi.js';

import type { GlobalUniformGroup } from '../core/GlobalUniformGroup';
import type { GlobalTextureBindings } from '../core/render-graph/TextureBinding';

/**
 * A view's global uniforms and bind group for one renderer, at `view._gpuData[renderer.uid]`;
 * pixi destroys it when the view unloads or the renderer is destroyed
 * @internal
 */
export class View3DGlobalData<TExtra extends Record<string, UniformData> = Record<never, UniformData>> {
  public readonly globalUniformGroup: GlobalUniformGroup<TExtra>;

  public readonly globalBindGroup: BindGroup;

  public readonly globalTextureBindings: GlobalTextureBindings;

  /** Last-seen `bufferVersion` of each shared store; `-1` makes the first render rebuild the draw caches */
  public lastMaterialStoreBufferVersion = -1;
  /** Separate from `View3D._lastAtlasBufferVersion` on purpose; that field says why */
  public lastAtlasBufferVersion = -1;
  public lastMorphStoreBufferVersion = -1;
  public lastGeometryStoreBufferVersion = -1;

  private _destroyed = false;

  constructor(
    globalUniformGroup: GlobalUniformGroup<TExtra>,
    globalBindGroup: BindGroup,
    globalTextureBindings: GlobalTextureBindings,
  ) {
    this.globalUniformGroup = globalUniformGroup;
    this.globalBindGroup = globalBindGroup;
    this.globalTextureBindings = globalTextureBindings;
  }

  /** Destroys the bind group before the buffer it binds */
  public destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    this.globalBindGroup.destroy();
    this.globalUniformGroup.buffer?.destroy();
  }
}
