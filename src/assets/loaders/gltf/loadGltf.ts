import { checkDataUrl, checkExtension, ExtensionType } from 'pixi.js';
import type { Loader, LoaderParser, ResolvedAsset } from 'pixi.js';

import type { Scene3DSource } from '../../Scene3DSource';
import type { GltfFormat } from './GltfFormat';
import { normalizeMeshopt } from './meshopt/normalizeMeshopt';
import { parseGltf } from './parseGltf';
import { loadImages } from './utils/loadImages';

/**
 * Loads a glTF file (`.gltf` plus its external `.bin` buffers and image files) and returns a
 * {@link Scene3DSource}
 *
 * `@pixi/3d` registers it with pixi's `Assets` on import. `Assets.unload(url)` destroys the source
 * and unloads every image the file referenced from the loader's cache, as pixi's spritesheets do
 * with their image, even when another loaded asset still uses one.
 *
 * Meshopt-compressed buffers (`EXT_meshopt_compression` / `KHR_meshopt_compression`) are decoded
 * transparently. Use {@link loadGlb} for the `.glb` binary container.
 * @example
 * ```ts
 * import { Assets } from 'pixi.js';
 * import { Model3D, type Scene3DSource } from '@pixi/3d';
 *
 * const source = await Assets.load<Scene3DSource>('robot.gltf');
 * view3d.root.addChild(new Model3D(source));
 * ```
 * @category assets
 * @advanced
 */
export const loadGltf = {
  extension: {
    type: ExtensionType.LoadParser,
    name: 'loadGltf',
  },
  id: 'gltf',
  test(url: string) {
    return checkDataUrl(url, 'model/gltf+json') || checkExtension(url, '.gltf');
  },
  async load(url: string, _resolvedAsset?: ResolvedAsset, loader?: Loader) {
    const response = await fetch(url);
    const json: GltfFormat = await response.json();
    const basePath = url.substring(0, url.lastIndexOf('/') + 1);

    const bufferPromises = (json.buffers || []).map(async (buffer) => {
      if (buffer.uri) {
        if (buffer.uri.startsWith('data:')) {
          const response = await fetch(buffer.uri);

          return await response.arrayBuffer();
        }

        const bufferUrl = basePath + buffer.uri;
        const bufferResponse = await fetch(bufferUrl);

        return await bufferResponse.arrayBuffer();
      }

      // URI-less "fallback buffer" per EXT/KHR_meshopt_compression: a stub
      // whose real data lives compressed in another buffer, accessed through
      // the bufferView's meshopt extension. Return a zero-length ArrayBuffer
      // so the Promise.all result stays positionally aligned with json.buffers;
      // normalizeMeshopt will drop it during compaction.
      const isMeshoptFallback =
        buffer.extensions?.EXT_meshopt_compression?.fallback === true ||
        buffer.extensions?.KHR_meshopt_compression?.fallback === true;

      if (isMeshoptFallback) {
        return new ArrayBuffer(0);
      }

      throw new Error('GLTF buffer has no URI');
    });

    const buffers = await Promise.all(bufferPromises);

    // Decode meshopt compression (if any) and compact `buffers` in place so
    // stubs and now-dead compressed-source buffers drop out before anything
    // downstream indexes into it.
    await normalizeMeshopt(json, buffers);

    const images = await loadImages(json.images || [], basePath, json, buffers, loader!);

    const source = await parseGltf(json, buffers, images.textures);

    source._imageUrls.push(...images.urls);

    return source;
  },
  async unload(source: Scene3DSource, _resolvedAsset?: ResolvedAsset, loader?: Loader) {
    // The loader destroys the image textures it cached, then the source frees everything else
    await loader!.unload(source._imageUrls);
    source.destroy();
  },
} satisfies LoaderParser<Scene3DSource>;
