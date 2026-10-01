import { RenderTarget, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { RenderTargetCache } from '~/core/render-graph/RenderTargetCache';

describe('RenderTargetCache.destroy', () => {
  it('tears down a minted color+depth target without throwing, which needs the color left attached, and preserves the shared sources', () => {
    const cache = new RenderTargetCache();
    const color = new TextureSource({ width: 4, height: 4 });
    const depth = new TextureSource({ width: 4, height: 4 });

    const target = cache.get({ colors: [{ texture: color }], depth: { texture: depth } });
    expect(target).toBeInstanceOf(RenderTarget);

    expect(() => cache.destroy()).not.toThrow();

    expect(color.destroyed).toBe(false);
    expect(depth.destroyed).toBe(false);

    color.destroy();
    depth.destroy();
  });

  it('tears down a minted depth-only target without throwing or leaking its resize listener', () => {
    const cache = new RenderTargetCache();
    const depth = new TextureSource({ width: 4, height: 4 });

    const target = cache.get({ depth: { texture: depth } });
    expect(target).toBeInstanceOf(RenderTarget);

    expect(depth.listenerCount('resize'), 'pixi sizes a depth-only target by its depth').toBeGreaterThan(0);

    expect(() => cache.destroy()).not.toThrow();
    expect(depth.destroyed).toBe(false);
    expect(depth.listenerCount('resize')).toBe(0);

    depth.destroy();
  });

  it('reset() releases owned targets whose pooled sources survive it, and destroy() releases one minted again over them', () => {
    const cache = new RenderTargetCache();
    const color = new TextureSource({ width: 4, height: 4 });
    const depth = new TextureSource({ width: 4, height: 4 });

    cache.get({ colors: [{ texture: color }], depth: { texture: depth } });
    expect(color.listenerCount('resize')).toBeGreaterThan(0);

    cache.reset();
    expect(color.listenerCount('resize'), 'a listener left behind would pin an orphaned target to the pool').toBe(0);
    expect(color.destroyed).toBe(false);
    expect(depth.destroyed).toBe(false);

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
