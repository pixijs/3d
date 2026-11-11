import { Loader, loadTextures } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadGltf } from '~/assets/loaders/gltf/loadGltf';

import { model } from '../../../../../examples/assets/manifest';

const DUCK = model('gltf.DuckQuantized');

function textureLoader(): Loader {
  const loader = new Loader();

  loader.parsers.push({ ...loadTextures, config: { ...loadTextures.config, preferWorkers: false } });

  return loader;
}

function holdBufferFetches(): { release: () => void; fail: (error: Error) => void } {
  const realFetch = globalThis.fetch.bind(globalThis);
  const held: {
    input: RequestInfo | URL;
    resolve: (response: Promise<Response>) => void;
    reject: (error: Error) => void;
  }[] = [];

  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (!url.endsWith('.bin')) return realFetch(input, init);

    return new Promise((resolve, reject) => held.push({ input, resolve, reject }));
  });

  return {
    release: () => held.forEach(({ input, resolve }) => resolve(realFetch(input))),
    fail: (error) => held.forEach(({ reject }) => reject(error)),
  };
}

async function imageLoaded(loader: Loader): Promise<Texture> {
  await vi.waitFor(() => expect(Object.keys(loader.promiseCache), 'the duck loads one URI image').toHaveLength(1));

  return Object.values(loader.promiseCache)[0].promise as Promise<Texture>;
}

describe('loadGltf', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads URI images while its buffers are still fetching', async () => {
    const loader = textureLoader();
    const buffers = holdBufferFetches();

    const loading = loadGltf.load(DUCK, undefined, loader);
    const texture = await imageLoaded(loader);
    buffers.release();
    const source = await loading;

    expect(source.textures[0]).toBe(texture);
    expect(source.geometries.length).toBeGreaterThan(0);

    await loadGltf.unload(source, undefined, loader);
  });

  it('unloads its loaded URI images when a buffer fetch fails', async () => {
    const loader = textureLoader();
    const buffers = holdBufferFetches();

    const loading = loadGltf.load(DUCK, undefined, loader);
    const texture = await imageLoaded(loader);
    buffers.fail(new TypeError('Failed to fetch'));

    await expect(loading).rejects.toThrow('Failed to fetch');
    expect(loader.promiseCache).toEqual({});
    expect(texture.destroyed).toBe(true);
  });
});
