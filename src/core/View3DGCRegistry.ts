import { GCManagedHash } from 'pixi.js';
import type { Renderer } from 'pixi.js';

import type { View3D } from '../scene/View3D';

/**
 * Enrolment of rendering Views in pixi's renderer garbage collector, one per View3D pipe
 *
 * The payload pixi runs for an enrolled View is the `View3DGlobalData` this renderer keeps at
 * `view3d._gpuData[renderer.uid]`. When the View emits `unload`, pixi's hash `remove` calls
 * `View3D._unloadPasses`, runs the payload's `destroy()`, and clears the slot and the entry;
 * `execute` mints a new payload and re-enrols the View on its next frame. A stale View is
 * collected by pixi calling {@link View3D.unload} directly, which hands the View's GPU memory back
 * and emits that event.
 *
 * What counts as stale: a View under a rendered render group is refreshed on every sweep from
 * the group's GC tick, visible or not, so only a View detached from every rendered tree ages
 * out. The exception is a View that owns a render group (`isRenderGroup`, `cacheAsTexture`,
 * rendered directly as `extract` does): its ticks stay equal after detachment and it never ages
 * out. `autoGarbageCollect = false` on the View is the opt-out.
 *
 * `GCManagedHash` is not public API in pixi's dev build: re-verify this file after any pixi
 * lockfile change.
 * @internal
 */
export class View3DGCRegistry {
  private readonly _managedViews: GCManagedHash<View3D>;

  constructor(renderer: Renderer) {
    this._managedViews = new GCManagedHash<View3D>({
      renderer,
      type: 'renderable',
      name: 'view3d',
      onUnload: (view3d) => view3d._unloadPasses(),
    });
  }

  /**
   * Enrol the View; a no-op while it is already enrolled
   * @param view3d - The View to enrol in the renderer's garbage collection
   */
  public track(view3d: View3D): void {
    this._managedViews.add(view3d);
  }

  /**
   * Renderer teardown: run each enrolled View's payload for this renderer only and clear its
   * slot. Never `View3D.unload()`, which is renderer-wide and would take GPU state a second
   * renderer is still drawing.
   *
   * Each View first drops its pass bind groups' references to this pipe's stores
   * (`View3D._unloadPasses`), so the pipe must call this before it frees the stores.
   */
  public destroy(): void {
    this._managedViews.destroy();
  }
}
