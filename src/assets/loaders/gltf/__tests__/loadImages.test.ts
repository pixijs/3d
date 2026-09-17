import { Loader, loadTextures } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GltfFormat, Image } from '~/assets/loaders/gltf/GltfFormat';
import { loadImages } from '~/assets/loaders/gltf/utils/loadImages';

/** Encodes a 4x2 PNG, the bytes a GLB embeds in a bufferView */
async function pngBytes(): Promise<ArrayBuffer> {
  const canvas = new OffscreenCanvas(4, 2);
  const context = canvas.getContext('2d')!;

  context.fillStyle = '#f00';
  context.fillRect(0, 0, 4, 2);

  return (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
}

/** A loader with only the texture parser; workers off, so the image's blob URL is the only one created */
function textureLoader(): Loader {
  const loader = new Loader();

  loader.parsers.push({ ...loadTextures, config: { ...loadTextures.config, preferWorkers: false } });

  return loader;
}

async function loadEmbedded(bytes: ArrayBuffer, loader: Loader): Promise<Texture[]> {
  const json: GltfFormat = {
    asset: { version: '2.0' },
    bufferViews: [{ buffer: 0, byteLength: bytes.byteLength }],
  };
  const images: Image[] = [{ bufferView: 0, mimeType: 'image/png' }];

  return (await loadImages(images, '', json, [bytes], loader)).textures;
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
    };
    const images: Image[] = [{ bufferView: 0, mimeType: 'image/png' }, { uri: 'missing.png' }];

    await expect(loadImages(images, '/', json, [bytes], loader)).rejects.toThrow('[Loader.load] Failed to load');

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
