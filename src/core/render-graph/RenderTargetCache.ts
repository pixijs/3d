import { RenderTarget } from 'pixi.js';
import type { RenderTargetDescriptor, TextureSource } from 'pixi.js';

/**
 * The attachments a render target is looked up by: live `TextureSource`s, plus whether the depth is read-only
 * @internal
 */
export interface PassAttachments {
  /** Color attachments, in slot order */
  colors?: { texture: TextureSource }[];
  /** Depth attachment */
  depth?: { texture: TextureSource };
  /** Attach the depth read-only, for a pass that depth-tests against it without writing it */
  depthReadOnly?: boolean;
}

/**
 * Caches `RenderTarget`s keyed by their attachment textures
 *
 * Pixi caches single-surface render targets but not color+depth combinations —
 * this fills that gap, so every pass writing the same attachment set shares one
 * backend framebuffer.
 * @internal
 */
export class RenderTargetCache {
  private readonly _targets: Record<string, RenderTarget> = Object.create(null);

  /**
   * Keys whose target this cache created, as opposed to one seeded with `addToCache`
   *
   * Only these are torn down. A seeded target is pixi's `session.defaultTarget`, which pixi owns
   * and the graph seeds again whenever the default target's textures change.
   */
  private readonly _ownedKeys: Set<string> = new Set();

  /**
   * Get — or lazily create — the `RenderTarget` for these attachments
   * @param attachments - Attachment set identifying the target.
   * @returns The shared `RenderTarget` for the attachment set.
   */
  public get(attachments: PassAttachments): RenderTarget {
    const key = this._renderTargetKey(attachments);
    if (!this._targets[key]) {
      this._targets[key] = this._createRenderTarget(attachments);
      this._ownedKeys.add(key);
    }
    return this._targets[key];
  }

  /**
   * Pre-register a `RenderTarget` under a known attachment set
   *
   * Used to seed `session.defaultTarget` so passes resolve to pixi's own
   * instance instead of a parallel `RenderTarget` wrapping the same textures.
   * @param attachments - Attachment set to register the target under.
   * @param renderTarget - The externally-owned target to seed.
   */
  public addToCache(attachments: PassAttachments, renderTarget: RenderTarget): void {
    const key = this._renderTargetKey(attachments);
    this._targets[key] = renderTarget;
    this._ownedKeys.delete(key);
  }

  /**
   * Drop every cached target on attachment-identity change (resize / swap-chain swap)
   *
   * Frees the graph-minted targets first: pooled attachment sources can
   * survive the reset, and a dropped-but-undestroyed target stays pinned to
   * them through pixi's `resize` listener — one orphan per reset.
   */
  public reset(): void {
    this._releaseOwned();
    for (const key in this._targets) delete this._targets[key];
  }

  /**
   * Tear down graph-minted targets (renderer / pipe teardown)
   *
   * The seeded `session.defaultTarget` is pixi-owned and never destroyed here.
   */
  public destroy(): void {
    this.reset();
  }

  /**
   * Frees every target this cache created, and its `resize` listener, without freeing any
   * attachment: the pool, the default target or a pass owns each attachment texture
   *
   * - Colour (and depth) targets: the depth is detached first, because pixi's `destroy()` destroys
   *   a depth attachment. The colour stays attached, since `destroy()` removes the listener through
   *   it, and pixi destroys colour textures only for a target that created them.
   * - Depth-only targets: pixi listens on the depth texture, the only one there is to size the
   *   target by. `destroy()` would destroy that texture, so the listener is removed by hand and the
   *   depth reference dropped.
   */
  private _releaseOwned(): void {
    for (const key of this._ownedKeys) {
      const target = this._targets[key];
      if (target.colorAttachments.length > 0) {
        target.depthStencilAttachment = undefined;
        target.destroy();
      } else {
        const source = target.sizeSource;
        const onResize = target['onSourceResize'];
        source?.off('resize', onResize, target);
        target.depthStencilAttachment = undefined;
      }
    }
    this._ownedKeys.clear();
  }

  private _createRenderTarget(attachments: PassAttachments): RenderTarget {
    const descriptor: RenderTargetDescriptor = { colorAttachments: [] };

    if (attachments.colors) {
      for (let i = 0; i < attachments.colors.length; i++) {
        descriptor.colorAttachments[i] = {
          texture: attachments.colors[i].texture,
          loadOp: 'load',
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

  /**
   * Build the cache key: colour uids in order, then `depth<uid>` with `_ro` when read-only
   *
   * Load, store and clear stay out: they are set per bind, not per target.
   * @param attachments - The pass's resolved color and depth attachments
   */
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
