import type { Loader, loadTextures, Texture } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GltfFormat } from '~/assets/loaders/gltf/GltfFormat';
import { loadImages } from '~/assets/loaders/gltf/utils/loadImages';

import { pngBytes, textureLoader } from './gltfFixtures';

async function loadEmbedded(bytes: ArrayBuffer, loader: Loader): Promise<Texture[]> {
  const json: GltfFormat = {
    asset: { version: '2.0' },
    bufferViews: [{ buffer: 0, byteLength: bytes.byteLength }],
    images: [{ bufferView: 0, mimeType: 'image/png' }],
    textures: [{ source: 0 }],
  };

  return (await loadImages(json, '', [bytes], loader)).textures;
}

describe('loadImages', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('revokes an embedded image blob URL once its texture has loaded', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL');
    const loader = textureLoader();

    const [texture] = await loadEmbedded(await pngBytes(), loader);
    const url = createObjectURL.mock.results[0].value as string;

    expect(texture.width).toBe(4);
    expect(texture.height).toBe(2);
    expect(revokeObjectURL).toHaveBeenCalledWith(url);
    await expect(fetch(url)).rejects.toThrow('Failed to fetch');

    await loader.unload(url);
  });

  it('unloads the images that did load when another image fails', async () => {
    const loader = textureLoader();
    const parser = loader.parsers[0] as typeof loadTextures & { unload: (texture: Texture) => void };
    const unload = vi.spyOn(parser, 'unload');
    const bytes = await pngBytes();
    const json: GltfFormat = {
      asset: { version: '2.0' },
      bufferViews: [{ buffer: 0, byteLength: bytes.byteLength }],
      images: [{ bufferView: 0, mimeType: 'image/png' }, { uri: 'missing.png' }],
      textures: [{ source: 0 }, { source: 1 }],
    };

    await expect(loadImages(json, '/', [bytes], loader)).rejects.toThrow('[Loader.load] Failed to load');

    expect(Object.keys(loader.promiseCache)).toEqual([]);
    expect(unload).toHaveBeenCalledTimes(1);
    expect(unload.mock.calls[0][0].destroyed).toBe(true);
  });

  it('revokes the blob URL when the embedded image fails to decode', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL');
    const notAPng = new TextEncoder().encode('not a png').buffer;

    await expect(loadEmbedded(notAPng, textureLoader())).rejects.toThrow('[Loader.load] Failed to load');

    expect(revokeObjectURL).toHaveBeenCalledWith(createObjectURL.mock.results[0].value);
  });
});
