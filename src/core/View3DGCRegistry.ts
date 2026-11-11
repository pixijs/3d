import { GCManagedHash, TexturePool } from 'pixi.js';
import type { Renderer } from 'pixi.js';

import type { View3D } from '../scene/View3D';

/**
 * Enrols a renderer's Views in pixi's GC and is their one texture pool `evict` listener, so the global pool holds
 * no View once the renderer is destroyed; pixi's internal `GCManagedHash` nulls dropped entries, whatever its type says
 * @internal
 */
export class View3DGCRegistry {
  private readonly _managedViews: GCManagedHash<View3D>;

  constructor(renderer: Renderer) {
    this._managedViews = new GCManagedHash<View3D>({ renderer, type: 'renderable', name: 'view3d' });
    TexturePool.on('evict', this._releasePooledTextures);
  }

  /** Reads `items` on each call, since pixi's GC sweep replaces the object */
  private readonly _releasePooledTextures = (): void => {
    const views = this._managedViews.items;
    for (const uid in views) {
      const view = views[uid];
      if (view) view._releasePooledTextures();
    }
  };

  /** Enrols the View; does nothing for one already enrolled */
  public track(view3d: View3D): void {
    this._managedViews.add(view3d);
  }

  /** Unloads every enrolled View; the pipe must call it before freeing the stores their draws bind */
  public destroy(): void {
    TexturePool.off('evict', this._releasePooledTextures);
    const views = Object.values(this._managedViews.items);
    for (let i = 0; i < views.length; i++) views[i]?.unload();
    this._managedViews.destroy();
  }
}
