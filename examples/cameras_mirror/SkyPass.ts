/** The pass that gives the mirror camera a sky: the view's background, drawn into its render texture */

import { BackgroundPass, Pass3D } from '@pixi/3d';
import type { Camera3D, PassContext, RenderGraph } from '@pixi/3d';

/**
 * Draws the view's background from `camera` before anything else in its picture
 *
 * Only the view's own camera draws the background by itself. A second camera's picture starts cleared to transparent
 * black, so without this the glass would show black wherever it reflects the sky.
 */
export class SkyPass extends Pass3D {
  // Ahead of the scene, with the camera's MeshPasses, so the feed is finished before the glass reads it.
  public readonly stage = 'beforeOpaque';
  private readonly _camera: Camera3D;

  constructor(camera: Camera3D) {
    super();
    this._camera = camera;
  }

  public build(graph: RenderGraph, { renderer }: PassContext): void {
    graph.addPass(new BackgroundPass({ renderer, camera: this._camera }));
  }
}
