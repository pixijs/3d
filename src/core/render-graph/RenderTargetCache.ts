import { RenderTarget } from 'pixi.js';
import type { RenderTargetDescriptor, TextureSource } from 'pixi.js';

/**
 * Resolved attachment set for a render-pass group
 *
 * `texture` fields point at live `TextureSource`s; `depthReadOnly`
 * distinguishes the read-only depth variant required by the
 * depth-sample-during-transparent pattern.
 * @internal
 */
export interface PassAttachments {
  /** Color attachments, in slot order */
  colors?: { texture: TextureSource }[];
  /** Depth attachment */
  depth?: { texture: TextureSource };
  /** Bind the depth attachment read-only (sampled while still depth-testing) */
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
   * Keys whose target was minted by this cache (`_createRenderTarget`), as
   * opposed to seeded via `addToCache`. Only graph-minted targets are torn
   * down in `destroy()` — seeded targets (pixi's `session.defaultTarget`) are
   * pixi-owned and re-seeded each frame.
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
   * Free every graph-minted target's own GPU object + resize listener WITHOUT
   * freeing any attachment — all attachment `TextureSource`s are externally
   * owned (transient-pool / default depth / pass color textures).
   *
   * - Color (+depth) targets: detach the depth so pixi's `destroy()` won't free
   *   the shared depth texture, but leave color attached so `sizeSource` still
   *   resolves for the resize-listener removal (color textures are minted with
   *   explicit `texture` objects, so `_managedColorTextures` is false and pixi
   *   leaves them alone).
   * - Depth-only targets: pixi still binds a `resize` listener, because
   *   `sizeSource` falls back to the depth texture. `destroy()` can't be used
   *   (it would free that externally-owned depth source), so remove the listener
   *   directly, then drop the depth reference.
   *
   * Seeded targets are never in `_ownedKeys`, so they are never touched.
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
   * Build the cache key: color uids in order, then `depth<uid>` with optional `_ro`
   *
   * Load/store/clear are excluded — they're per-pass state, not identity.
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
