import { RenderTarget } from 'pixi.js';
import type { RenderTargetDescriptor, TextureSource } from 'pixi.js';

/** @internal */
export interface PassAttachments {
  colors?: { texture: TextureSource }[];
  depth?: { texture: TextureSource };
  depthReadOnly?: boolean;
}

/** @internal */
export class RenderTargetCache {
  private readonly _targets: Record<string, RenderTarget> = Object.create(null);

  /** Keys of the targets this cache made; a target given to `addToCache` is pixi's, and never destroyed here */
  private readonly _ownedKeys: Set<string> = new Set();

  public get(attachments: PassAttachments): RenderTarget {
    const key = this._renderTargetKey(attachments);
    if (!this._targets[key]) {
      this._targets[key] = this._createRenderTarget(attachments);
      this._ownedKeys.add(key);
    }
    return this._targets[key];
  }

  public addToCache(attachments: PassAttachments, renderTarget: RenderTarget): void {
    const key = this._renderTargetKey(attachments);
    this._targets[key] = renderTarget;
    this._ownedKeys.delete(key);
  }

  /**
   * Destroys the targets it made rather than dropping them, since each listens on a source that can
   * outlive the reset; `RenderGraph._invalidatePerPassTargets` drops the graph's references to them
   */
  public reset(): void {
    this._releaseOwned();
    for (const key in this._targets) delete this._targets[key];
  }

  public destroy(): void {
    this.reset();
  }

  private _releaseOwned(): void {
    for (const key of this._ownedKeys) this._targets[key].destroy();
    this._ownedKeys.clear();
  }

  private _createRenderTarget(attachments: PassAttachments): RenderTarget {
    const descriptor: RenderTargetDescriptor = { colorAttachments: [] };

    if (attachments.colors) {
      for (let i = 0; i < attachments.colors.length; i++) {
        descriptor.colorAttachments[i] = {
          texture: attachments.colors[i].texture,
          storeOp: 'store',
        };
      }
    }

    if (descriptor.colorAttachments.length === 0 && !attachments.depth) {
      throw new Error('RenderTargetCache: cannot build a render target with no color or depth attachment');
    }

    if (attachments.depth) {
      descriptor.depthStencilAttachment = {
        texture: attachments.depth.texture,
        depthReadOnly: attachments.depthReadOnly,
      };
    }

    return new RenderTarget(descriptor);
  }

  /** Load ops and clear values stay out of the key: `RenderGraph._setColorAttachments` sets them on every bind */
  private _renderTargetKey(attachments: PassAttachments): string {
    const parts: (string | number)[] = [];

    if (attachments.colors) {
      for (let i = 0; i < attachments.colors.length; i++) {
        parts.push(attachments.colors[i].texture.uid);
      }
    }

    if (attachments.depth) {
      parts.push(`depth${attachments.depth.texture.uid}${attachments.depthReadOnly ? '_ro' : ''}`);
    }

    return parts.join('_');
  }
}
