/**
 * `brdf-lut`: what baking the BRDF lookup table costs. The view pipe bakes it once per renderer, inside the first
 * frame that has a view with an environment, so every app with an environment pays it in its first frame. This bench
 * drops the pipe's table before every frame, so every frame bakes it again: `gpu.frame` is that bake plus one sphere
 * lit by a hemisphere environment. The table lives in a private field of the pipe, which `update` clears. It also drops
 * the view's recorded WebGPU bundles, which baked the old table's bind group, and destroys the dropped table a frame
 * later, once the render that baked its replacement has bound that one instead.
 */

import { Material3D, Mesh3D, SphereGeometry } from '@pixi/3d';
import { frame } from 'benchy';
import type { Texture } from 'pixi.js';

import type { PixiStage } from './stage.ts';

/** The private field of the view pipe that holds the baked table. */
interface PipeWithLut {
  _brdfLutTexture?: Texture;
}

frame('brdf-lut', {
  primary: 'gpu.frame',
  antialias: false,
  create(stage: PixiStage) {
    const { renderer, view } = stage;
    view.environment = { skyColor: 0xffffff, groundColor: 0x404040 };
    const geometry = new SphereGeometry({ radius: 8 });
    const material = new Material3D({ baseColor: 0xffffff, metallic: 1, roughness: 0.3 });
    view.root.addChild(new Mesh3D({ geometry, material, castShadow: false, receiveShadow: false }));
    const pipe = (renderer.renderPipes as unknown as Record<string, PipeWithLut>).view3d;
    if (!pipe) throw new Error('brdf-lut: the renderer has no view3d pipe');
    let previous: Texture | undefined;
    return {
      update() {
        previous?.destroy(true);
        previous = pipe._brdfLutTexture;
        pipe._brdfLutTexture = undefined;
        view._invalidateBundleCaches();
      },
      destroy() {
        previous?.destroy(true);
        geometry.destroy(true);
        material.destroy();
      },
    };
  },
});
