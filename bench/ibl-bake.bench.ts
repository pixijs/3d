/**
 * `ibl-bake`: what prefiltering a cube environment costs. The view pipe bakes the environment's specular cube once,
 * in the first frame that binds it, so an app pays it as a first-frame stall. floating-laptop paints a soft-box studio
 * cube, 256 texels a face on desktop and 128 on touch devices; the variants are those two sizes and a 512 one. This
 * bench drops the pipe's baked cube before every frame, so every frame bakes it again: `gpu.frame` is that bake plus
 * six spheres from mirror to fully rough reflecting it. The cube lives in a private map of the pipe, which `update`
 * clears, taking off the destroy listener the bake added; the dropped cube is destroyed a frame later, once the render
 * that baked its replacement has bound that one instead.
 */

import { Material3D, Mesh3D, SphereGeometry } from '@pixi/3d';
import { frame } from 'benchy';
import { BufferImageSource, CubeTexture, Texture } from 'pixi.js';
import type { TextureSource } from 'pixi.js';

import type { PixiStage } from './stage.ts';

/** The private members of the view pipe that hold the baked cubes. */
interface PipeWithCubes {
  _iblEnvironmentMap: Map<TextureSource, CubeTexture>;
  _onEnvironmentDestroy: (source: TextureSource) => void;
}

/** One face of a dim studio: a vertical grey gradient with a soft-edged bright panel off its centre. */
function studioFace(size: number, face: number): Texture {
  const pixels = new Uint8Array(size * size * 4);
  const panelX = 0.3 + 0.08 * face;
  const panelY = 0.35 + 0.05 * (face % 3);
  for (let row = 0; row < size; row++) {
    const v = (row + 0.5) / size;
    for (let column = 0; column < size; column++) {
      const u = (column + 0.5) / size;
      const dx = Math.max(0, Math.abs(u - panelX) - 0.12) / 0.08;
      const dy = Math.max(0, Math.abs(v - panelY) - 0.2) / 0.08;
      const panel = Math.max(0, 1 - Math.hypot(dx, dy));
      const base = 30 + 50 * (1 - v);
      const at = (row * size + column) * 4;
      pixels[at] = Math.min(255, base + 220 * panel);
      pixels[at + 1] = Math.min(255, base + 200 * panel);
      pixels[at + 2] = Math.min(255, base * 1.1 + 190 * panel);
      pixels[at + 3] = 255;
    }
  }
  return new Texture({
    source: new BufferImageSource({ resource: pixels, format: 'rgba8unorm', width: size, height: size }),
  });
}

frame('ibl-bake', {
  variants: { s128: { size: 128 }, s256: { size: 256 }, s512: { size: 512 } },
  primary: 'gpu.frame',
  antialias: false,
  create({ renderer, view }: PixiStage, { size }: { size: number }) {
    const faces = [0, 1, 2, 3, 4, 5].map((face) => studioFace(size, face));
    const environment = CubeTexture.from({
      faces: { right: faces[0], left: faces[1], top: faces[2], bottom: faces[3], front: faces[4], back: faces[5] },
    });
    view.environment = environment;

    const geometry = new SphereGeometry({ radius: 2.5 });
    const materials: Material3D[] = [];
    for (let i = 0; i < 6; i++) {
      const material = new Material3D({ baseColor: 0xffffff, metallic: 1, roughness: i / 5 });
      materials.push(material);
      const mesh = new Mesh3D({ geometry, material, castShadow: false, receiveShadow: false });
      mesh.position.set((i - 2.5) * 6, 0, 0);
      view.root.addChild(mesh);
    }

    const pipe = (renderer.renderPipes as unknown as Record<string, PipeWithCubes>).view3d;
    if (!pipe) throw new Error('ibl-bake: the renderer has no view3d pipe');
    let previous: CubeTexture | undefined;
    return {
      update() {
        previous?.destroy(true);
        previous = pipe._iblEnvironmentMap.get(environment.source);
        pipe._iblEnvironmentMap.delete(environment.source);
        environment.source.off('destroy', pipe._onEnvironmentDestroy);
      },
      destroy() {
        view.environment = null;
        previous?.destroy(true);
        geometry.destroy(true);
        for (const material of materials) material.destroy();
        environment.destroy(true);
        for (const face of faces) face.destroy(true);
      },
    };
  },
});
