import { expectCleanRender, getApp } from '@test-utils';
import { CompressedSource, detectAvif, GlobalResourceRegistry, loadKTX2 } from 'pixi.js';
import type { LoaderParser, Renderer, WebGLRenderer } from 'pixi.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GltfFormat } from '~/assets/loaders/gltf/GltfFormat';
import { loadGlb } from '~/assets/loaders/gltf/loadGlb';
import { loadGltf } from '~/assets/loaders/gltf/loadGltf';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

import { model } from '../../../../../examples/assets/manifest';
import { packGlb, pngBytes, textureLoader, webpBytes } from './gltfFixtures';

const KTX2_URL = new URL('dgg_basecolor.ktx2', new URL(model('gltf.ChronographWatchKtx2'), location.href)).href;

const AVIF =
  'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A=';

const KTX2_PARSER = loadKTX2 as LoaderParser;

let png: string;
let webp: string;
let ktx2Bytes: ArrayBuffer;
let ktx2: string;

function dataUri(bytes: ArrayBuffer, mimeType: string): string {
  return `data:${mimeType};base64,${btoa(String.fromCharCode(...new Uint8Array(bytes)))}`;
}

function gltfUrl(images: string[], textures: GltfFormat.Texture[], extensionsRequired?: string[]): string {
  const json: GltfFormat = {
    asset: { version: '2.0' },
    extensionsRequired,
    images: images.map((uri) => ({ uri })),
    textures,
  };

  return `data:model/gltf+json,${encodeURIComponent(JSON.stringify(json))}`;
}

function embeddedKtx2Glb(): Blob {
  const json: GltfFormat = {
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_texture_basisu'],
    extensionsRequired: ['KHR_texture_basisu'],
    buffers: [{ byteLength: ktx2Bytes.byteLength }],
    bufferViews: [{ buffer: 0, byteLength: ktx2Bytes.byteLength }],
    images: [{ bufferView: 0, mimeType: 'image/ktx2' }],
    textures: [{ extensions: { KHR_texture_basisu: { source: 0 } } }],
  };

  return packGlb(json, new Uint8Array(ktx2Bytes));
}

beforeAll(async () => {
  png = dataUri(await pngBytes(), 'image/png');
  webp = dataUri(await webpBytes(), 'image/webp');
  ktx2Bytes = await (await fetch(KTX2_URL)).arrayBuffer();
  ktx2 = dataUri(ktx2Bytes, 'image/ktx2');
});

describe('KHR_texture_basisu', () => {
  it("rejects a KTX2-only texture, naming the extension and 'pixi.js/ktx2', when the loader has no KTX2 parser", async () => {
    const url = gltfUrl([ktx2], [{ extensions: { KHR_texture_basisu: { source: 0 } } }], ['KHR_texture_basisu']);

    await expect(loadGltf.load(url, undefined, textureLoader())).rejects.toThrow(
      /texture 0 .*KHR_texture_basisu.*import 'pixi\.js\/ktx2'/,
    );
  });

  it('loads a KTX2 image embedded in a .glb, and unloading the model releases it', async () => {
    const loader = textureLoader(KTX2_PARSER);
    const url = URL.createObjectURL(embeddedKtx2Glb());

    try {
      const source = await loadGlb.load(url, undefined, loader);
      const texture = source.textures[0];

      expect(texture.source).toBeInstanceOf(CompressedSource);
      expect([texture.width, texture.height]).toEqual([512, 256]);

      await loadGlb.unload(source, undefined, loader);

      expect(texture.destroyed).toBe(true);
      expect(Object.keys(loader.promiseCache)).toEqual([]);
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  for (const preference of ['webgl', 'webgpu'] as const) {
    it(`draws a KTX2 texture without a ${preference} error`, async () => {
      const loader = textureLoader(KTX2_PARSER);
      const url = gltfUrl([ktx2], [{ extensions: { KHR_texture_basisu: { source: 0 } } }]);
      const source = await loadGltf.load(url, undefined, loader);
      const app = await getApp<Renderer>({
        id: `ktx2-${preference}`,
        appOptions: { preference, width: 32, height: 32 },
      });

      try {
        const view3d = new View3D({ width: 32, height: 32 });
        const material = new Material3D({ baseColorTexture: source.textures[0] });

        app.stage.addChild(view3d);
        view3d.root.addChild(new Mesh3D({ geometry: new PlaneGeometry({ width: 4, height: 4 }), material }));
        view3d.camera.position.set(0, 0, 4);

        await expectCleanRender(app);

        const { NO_ERROR } = WebGL2RenderingContext;
        const glError = preference === 'webgl' ? (app.renderer as WebGLRenderer).gl.getError() : NO_ERROR;

        expect(glError).toBe(NO_ERROR);
      } finally {
        app.destroy();
        await loadGltf.unload(source, undefined, loader);
      }
    });
  }
});

describe('EXT_texture_avif', () => {
  beforeEach(() => {
    GlobalResourceRegistry.release();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the AVIF over the PNG fallback when the browser decodes AVIF', async () => {
    const loader = textureLoader();
    const url = gltfUrl([png, AVIF], [{ source: 0, extensions: { EXT_texture_avif: { source: 1 } } }]);

    const source = await loadGltf.load(url, undefined, loader);

    expect(source.textures[0].width).toBe(2);
    expect(Object.keys(loader.promiseCache)).toEqual([AVIF]);

    await loadGltf.unload(source, undefined, loader);
  });

  it("uses the PNG fallback, and never loads the AVIF, when the browser can't decode AVIF", async () => {
    vi.spyOn(detectAvif, 'test').mockResolvedValue(false);
    const loader = textureLoader();
    const url = gltfUrl([png, AVIF], [{ source: 0, extensions: { EXT_texture_avif: { source: 1 } } }]);

    const source = await loadGltf.load(url, undefined, loader);

    expect(Object.keys(loader.promiseCache)).toEqual([png]);

    await loadGltf.unload(source, undefined, loader);
  });

  it("rejects an AVIF-only texture, naming the extension, when the browser can't decode AVIF", async () => {
    vi.spyOn(detectAvif, 'test').mockResolvedValue(false);
    const url = gltfUrl([AVIF], [{ extensions: { EXT_texture_avif: { source: 0 } } }], ['EXT_texture_avif']);

    await expect(loadGltf.load(url, undefined, textureLoader())).rejects.toThrow(
      /texture 0 .*EXT_texture_avif.*can't decode AVIF/,
    );
  });

  it('checks AVIF support once for models that load at the same time', async () => {
    const detect = vi.spyOn(detectAvif, 'test');
    const url = gltfUrl([png, AVIF], [{ source: 0, extensions: { EXT_texture_avif: { source: 1 } } }]);
    const loaders = [textureLoader(), textureLoader()];

    const sources = await Promise.all(loaders.map((loader) => loadGltf.load(url, undefined, loader)));

    expect(detect).toHaveBeenCalledTimes(1);

    await Promise.all(sources.map((source, i) => loadGltf.unload(source, undefined, loaders[i])));
  });
});

describe('image preference', () => {
  it("prefers the KTX2 image when the loader has pixi's KTX2 parser, then the WebP, then the PNG", async () => {
    const url = gltfUrl(
      [png, ktx2, webp],
      [{ source: 0, extensions: { KHR_texture_basisu: { source: 1 }, EXT_texture_webp: { source: 2 } } }],
    );
    const ktx2Loader = textureLoader(KTX2_PARSER);
    const plainLoader = textureLoader();

    const withKtx2 = await loadGltf.load(url, undefined, ktx2Loader);
    const withoutKtx2 = await loadGltf.load(url, undefined, plainLoader);

    expect(Object.keys(ktx2Loader.promiseCache)).toEqual([ktx2]);
    expect(Object.keys(plainLoader.promiseCache)).toEqual([webp]);

    await loadGltf.unload(withKtx2, undefined, ktx2Loader);
    await loadGltf.unload(withoutKtx2, undefined, plainLoader);
  });
});
