import { getApp, renderFrame } from '@test-utils';
import { Assets } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { BaseMaterial3D } from '~/materials/BaseMaterial3D';
import { Mesh3D } from '~/scene/Mesh3D';

import { model as sample } from '../../../examples/assets/manifest';
import { renderGltfModel } from '../../../tests/scenes/gltf/frameModel';

const SIZE = 256;
const HEX_COLOUR_READ_BACK_ROUNDING = 3;

const layoutChangingNoopBit: ShaderBit = {
  name: 'cloneRenderNoop',
  bindings: { material: { noopTint: 'vec3<f32>' } },
  textures: ['noopMask'],
};

const SAMPLE_BY_FEATURE = {
  'PBR maps and emissive': 'gltf.DamagedHelmet',
  transmission: 'gltf.TransmissionTest',
  unlit: 'gltf.UnlitTest',
  'texture transforms': 'gltf.TextureTransformTest',
  'alpha modes': 'gltf.AlphaBlendModeTest',
} as const;

function maxChannelDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));

  return max;
}

function pixelsOffBackground(pixels: Uint8ClampedArray): number {
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (Math.abs(pixels[i] - 0x19) + Math.abs(pixels[i + 1] - 0x19) + Math.abs(pixels[i + 2] - 0x19) > 6) count++;
  }

  return count;
}

function swapInOneCopyPerMaterial(
  meshes: Mesh3D[],
  copy: (material: BaseMaterial3D) => BaseMaterial3D,
): BaseMaterial3D[] {
  const copies = new Map<BaseMaterial3D, BaseMaterial3D>();
  for (const mesh of meshes) {
    let material = copies.get(mesh.material);
    if (!material) copies.set(mesh.material, (material = copy(mesh.material)));
    mesh.material = material;
  }

  return [...copies.values()];
}

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`clone() draws loaded materials unchanged (${preference})`, () => {
    for (const [feature, name] of Object.entries(SAMPLE_BY_FEATURE)) {
      it(`${name} (${feature}): a copy draws as the original, give or take its colours rounding to 8-bit hex, plain or with a no-op bit`, async () => {
        const url = sample(name);
        const app = await getApp<Renderer>({
          id: `clone-render-${name}-${preference}`,
          appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x191919 },
          assets: url,
        });

        try {
          expect(app.renderer.name).toBe(preference);

          const model = await renderGltfModel(app, { url });
          const meshes: Mesh3D[] = [];
          model.traverse((node) => {
            if (node instanceof Mesh3D) meshes.push(node);
          });
          const loaded = meshes.map((mesh) => mesh.material);

          await renderFrame(app);
          await renderFrame(app);
          const original = await renderFrame(app);

          const plain = swapInOneCopyPerMaterial(meshes, (material) => material.clone());
          const cloned = await renderFrame(app);

          meshes.forEach((mesh, i) => (mesh.material = loaded[i]));
          const withBit = swapInOneCopyPerMaterial(meshes, (material) =>
            material.clone({ extraBits: [layoutChangingNoopBit] }),
          );
          const bitAdded = await renderFrame(app);

          expect(
            pixelsOffBackground(original),
            "the model draws, so two blank frames can't pass as equal",
          ).toBeGreaterThan((SIZE * SIZE) / 50);
          expect(maxChannelDiff(cloned, original), 'clone()').toBeLessThanOrEqual(HEX_COLOUR_READ_BACK_ROUNDING);
          expect(maxChannelDiff(bitAdded, original), 'clone() with a no-op bit').toBeLessThanOrEqual(
            HEX_COLOUR_READ_BACK_ROUNDING,
          );

          meshes.forEach((mesh, i) => (mesh.material = loaded[i]));
          for (const copy of [...plain, ...withBit]) copy.destroy();

          expect(maxChannelDiff(await renderFrame(app), original), 'the original, its copies destroyed').toBe(0);
        } finally {
          app.destroy();
          await Assets.unload(url);
        }
      });
    }
  });
}
