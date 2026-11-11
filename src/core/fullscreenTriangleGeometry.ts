import { Geometry, GlobalResourceRegistry } from 'pixi.js';

let triangle: Geometry | undefined;

GlobalResourceRegistry.register({
  clear: () => {
    triangle?.destroy(true);
    triangle = undefined;
  },
});

/**
 * The oversized clip-space triangle every fullscreen draw shares; it outlives every draw, since WebGPU submits draws
 * later and a buffer destroyed first voids the frame, and only `releaseGlobalResources` on a renderer destroy frees it
 * @internal
 */
export function fullscreenTriangleGeometry(): Geometry {
  triangle ??= new Geometry({
    attributes: {
      aPosition: new Float32Array([-1, -1, 3, -1, -1, 3]),
    },
  });
  return triangle;
}
