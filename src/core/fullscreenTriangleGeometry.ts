import { Geometry, GlobalResourceRegistry } from 'pixi.js';

let triangle: Geometry | undefined;

GlobalResourceRegistry.register({
  clear: () => {
    triangle?.destroy(true);
    triangle = undefined;
  },
});

/**
 * The oversized clip-space triangle every fullscreen draw shares
 *
 * One primitive covers clip space [-1, 1]^2 with no diagonal seam; the viewport clips it to
 * the target rect. `aPosition` interpolates linearly, so anything a vertex stage derives from
 * it linearly (a UV, an unnormalised direction) is exact at every pixel.
 *
 * Kept alive rather than owned per draw or per pass: on WebGPU a draw is encoded into the
 * frame's command buffer and only submitted later, and a buffer destroyed before that submit
 * voids the whole frame. It is page-global, shared by every renderer, so only a full engine reset
 * (`renderer.destroy({ releaseGlobalResources: true })`) destroys it, along with pixi's shared
 * pools; the next call builds a new one.
 * @returns The shared triangle, created on first use
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
