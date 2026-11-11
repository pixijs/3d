import { FlatMaterial, Mesh3D, SphereGeometry } from '@pixi/3d';
import { frame } from 'benchy';

import { toTexture } from './stage.ts';
import type { PixiStage } from './stage.ts';

/**
 * `sorted-textured`: 2 000 alpha-blended spheres, each with a material of its own, sharing 8 textures, while the
 * camera circles them
 *
 * The blended pass re-sorts and rebuilds its draw list every frame, and every material is its own, so a rebuild
 * meets 2 000 textured materials: the worst case for work done per material per rebuild. Judged on `cpu.render`.
 */

const TEXTURES = 8;
const SIZE = 16;

/** A `SIZE`² texture of one colour */
function solid(index: number) {
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  for (let at = 0; at < pixels.length; at += 4) {
    pixels[at] = (index * 37) & 255;
    pixels[at + 1] = (index * 91) & 255;
    pixels[at + 2] = (index * 53) & 255;
    pixels[at + 3] = 255;
  }
  return toTexture({ pixels, width: SIZE, height: SIZE }, `solid-${index}`);
}

frame('sorted-textured', {
  variants: { c2000: { count: 2000 } },
  primary: 'cpu.render',
  create(stage: PixiStage, { count }: { count: number }) {
    const { view, rng } = stage;
    const geometry = new SphereGeometry({ radius: 0.6, widthSegments: 12, heightSegments: 8 });
    const textures = Array.from({ length: TEXTURES }, (_, i) => solid(i));
    const materials: FlatMaterial[] = [];
    for (let i = 0; i < count; i++) {
      const material = new FlatMaterial({ baseColorTexture: textures[i % TEXTURES], alpha: 0.5, alphaMode: 'blend' });
      materials.push(material);
      const mesh = new Mesh3D({ geometry, material, castShadow: false });
      mesh.position.set(rng.range(-14, 14), rng.range(-14, 14), rng.range(-14, 14));
      view.root.addChild(mesh);
    }
    let angle = 0;
    return {
      simulate(seconds) {
        angle = seconds * 0.5;
      },
      update() {
        view.camera.position.set(Math.sin(angle) * 40, 6, Math.cos(angle) * 40);
        view.camera.lookAt({ x: 0, y: 0, z: 0 });
      },
      destroy() {
        geometry.destroy(true);
        for (const material of materials) material.destroy();
        for (const texture of textures) texture.destroy(true);
      },
    };
  },
});
