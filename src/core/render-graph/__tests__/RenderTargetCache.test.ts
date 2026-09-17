import { RenderTarget, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { RenderTargetCache } from '~/core/render-graph/RenderTargetCache';

describe('RenderTargetCache.destroy', () => {
  it('tears down a minted color+depth target without throwing and preserves the shared sources', () => {
    const cache = new RenderTargetCache();
    const color = new TextureSource({ width: 4, height: 4 });
    const depth = new TextureSource({ width: 4, height: 4 });

    // get() mints + owns a color+depth RenderTarget (the path graph passes hit when
    // they write a transient attachment). The attachment sources are externally owned.
    const target = cache.get({ colors: [{ texture: color }], depth: { texture: depth } });
    expect(target).toBeInstanceOf(RenderTarget);

    // destroy() must free the owned target's framebuffer without freeing the shared
    // attachment sources, and without throwing — clearing the color attachment too
    // (so sizeSource resolves to undefined) makes RenderTarget.destroy's sizeSource.off
    // throw, which is the regression this guards.
    expect(() => cache.destroy()).not.toThrow();

    expect(color.destroyed).toBe(false);
    expect(depth.destroyed).toBe(false);

    color.destroy();
    depth.destroy();
  });

  it('tears down a minted depth-only target without throwing or leaking its resize listener', () => {
    const cache = new RenderTargetCache();
    const depth = new TextureSource({ width: 4, height: 4 });

    // _createRenderTarget permits a depth-only owned target (no color attachment).
    const target = cache.get({ depth: { texture: depth } });
    expect(target).toBeInstanceOf(RenderTarget);

    // pixi binds onSourceResize to the depth source (sizeSource falls back to it).
    expect(depth.listenerCount('resize')).toBeGreaterThan(0);

    expect(() => cache.destroy()).not.toThrow();
    // The shared depth source survives, and its resize listener is removed (not leaked).
    expect(depth.destroyed).toBe(false);
    expect(depth.listenerCount('resize')).toBe(0);

    depth.destroy();
  });

  it('reset() releases owned targets whose pooled sources survive the reset', () => {
    const cache = new RenderTargetCache();
    const color = new TextureSource({ width: 4, height: 4 });
    const depth = new TextureSource({ width: 4, height: 4 });

    cache.get({ colors: [{ texture: color }], depth: { texture: depth } });
    expect(color.listenerCount('resize')).toBeGreaterThan(0);

    // A reset (attachment-identity change) drops the cache entries while pooled
    // transient sources live on — the minted target must be destroyed with
    // them, or its resize listener pins one orphaned RenderTarget to the pool
    // per reset.
    cache.reset();
    expect(color.listenerCount('resize')).toBe(0);
    expect(color.destroyed).toBe(false);
    expect(depth.destroyed).toBe(false);

    // Re-minting over the same surviving sources starts a fresh generation
    // that destroy() still tears down in full.
    cache.get({ colors: [{ texture: color }], depth: { texture: depth } });
    expect(color.listenerCount('resize')).toBeGreaterThan(0);
    cache.destroy();
    expect(color.listenerCount('resize')).toBe(0);

    color.destroy();
    depth.destroy();
  });

  it('is safe to call destroy twice', () => {
    const cache = new RenderTargetCache();
    const color = new TextureSource({ width: 4, height: 4 });

    cache.get({ colors: [{ texture: color }], depth: { texture: new TextureSource({ width: 4, height: 4 }) } });

    cache.destroy();
    expect(() => cache.destroy()).not.toThrow();

    color.destroy();
  });
});
