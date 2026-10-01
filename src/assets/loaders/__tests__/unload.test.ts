import { getApp } from '@test-utils';
import { Assets } from 'pixi.js';
import type { Application, CubeTexture, Renderer, TextureSource } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import type { Scene3DSource } from '~/assets/Scene3DSource';
import { Model3D } from '~/scene/Model3D';
import { View3D } from '~/scene/View3D';

const SIZE = 64;

/** A GLB, whose embedded images load through blob URLs, and a glTF, whose images are separate files */
const FILES = ['/TextureTransformMultiTest.glb', '/duck-quantized/Duck.gltf'];

/** pixi keeps one GPU copy per renderer of a texture source, keyed by renderer uid. */
function gpuCopyCount(sources: TextureSource[]): number {
  let n = 0;
  for (const source of sources) n += Object.keys((source as unknown as { _gpuData: object })._gpuData).length;
  return n;
}

function textureSources(source: Scene3DSource): TextureSource[] {
  return [...new Set(source.textures.map((texture) => texture.source))];
}

/** Runs `Assets.unload(url)` and returns what pixi warned, e.g. that a cached texture was destroyed instead of unloaded */
async function unloadWarnings(url: string): Promise<string[]> {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await Assets.unload(url);
    return spy.mock.calls.map((args) => args.join(' '));
  } finally {
    spy.mockRestore();
  }
}

/** The loader's cache keys that `run` added */
async function newCacheKeys(run: () => Promise<unknown>): Promise<string[]> {
  const before = new Set(Object.keys(Assets.loader.promiseCache));
  await run();
  return Object.keys(Assets.loader.promiseCache).filter((key) => !before.has(key));
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`Assets.unload of 3D assets (${preference})`, () => {
    async function withApp(id: string, run: (app: Application<Renderer>) => Promise<void>): Promise<void> {
      const app = await getApp<Renderer>({
        id: `${id}-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });
      try {
        await run(app);
      } finally {
        app.destroy();
      }
    }

    /** Draws a model of `source` once so its textures and geometry reach the GPU */
    function draw(app: Application<Renderer>, source: Scene3DSource): () => void {
      const view3d = new View3D({ width: SIZE, height: SIZE });
      app.stage.addChild(view3d);
      view3d.camera.position.set(0, 0, 4);
      view3d.root.addChild(new Model3D(source));
      app.render();

      return () => view3d.destroy({ children: true });
    }

    for (const file of FILES) {
      it(`frees ${file} and the images it loaded, then loads it again`, async () => {
        await withApp(`unload-${file}`, async (app) => {
          const url = `${file}?unload-${preference}`;
          let source!: Scene3DSource;

          const cacheKeys = await newCacheKeys(async () => {
            source = await Assets.load<Scene3DSource>(url);
          });
          const sources = textureSources(source);
          const materials = [...source.materials];
          expect(sources.length).toBeGreaterThan(0);

          const clear = draw(app, source);
          expect(gpuCopyCount(sources)).toBeGreaterThan(0);
          clear();

          expect(await unloadWarnings(url)).toEqual([]);

          expect(source.destroyed).toBe(true);
          expect(sources.every((textureSource) => textureSource.destroyed)).toBe(true);
          expect(gpuCopyCount(sources)).toBe(0);
          expect(materials.every((material) => material.destroyed)).toBe(true);
          for (const key of cacheKeys) expect(Assets.loader.promiseCache[key]).toBeUndefined();

          const reloaded = await Assets.load<Scene3DSource>(url);
          expect(reloaded).not.toBe(source);
          expect(reloaded.textures.every((texture) => !texture.destroyed)).toBe(true);

          const clearReloaded = draw(app, reloaded);
          expect(gpuCopyCount(textureSources(reloaded))).toBeGreaterThan(0);
          clearReloaded();

          await Assets.unload(url);
        });
      }, 30000);
    }

    it('frees a cubemap and its six face textures, then loads it again', async () => {
      await withApp('unload-cubemap', async (app) => {
        const url = `/skybox/skybox.cubemap?unload-${preference}`;
        let cube!: CubeTexture;

        const cacheKeys = await newCacheKeys(async () => {
          cube = await Assets.load<CubeTexture>(url);
        });
        const faces = Object.values(cube.source.faces);
        app.renderer.texture.initSource(cube.source);
        expect(gpuCopyCount([cube.source])).toBeGreaterThan(0);

        expect(await unloadWarnings(url)).toEqual([]);

        expect(cube.destroyed).toBe(true);
        expect(cube.source.destroyed).toBe(true);
        expect(gpuCopyCount([cube.source])).toBe(0);
        expect(faces.every((face) => face.destroyed)).toBe(true);
        for (const key of cacheKeys) expect(Assets.loader.promiseCache[key]).toBeUndefined();

        const reloaded = await Assets.load<CubeTexture>(url);
        expect(reloaded).not.toBe(cube);
        expect(reloaded.destroyed).toBe(false);

        await Assets.unload(url);
      });
    }, 30000);
  });
}
