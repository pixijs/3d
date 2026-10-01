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
 * Meshopt-compressed buffers (`EXT_meshopt_compression` / `KHR_meshopt_compression`) and
 * Draco-compressed meshes (`KHR_draco_mesh_compression`) are decoded as they load; Draco fetches its
 * decoder from the URLs {@link setDracoDecoderPath} sets. Use {@link loadGlb} for the `.glb` binary
 * container.
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
  name: 'loadGltf',
  id: 'gltf',
  test(url: string) {
    return checkDataUrl(url, 'model/gltf+json') || checkExtension(url, '.gltf');
  },
  /**
   * Fetches the file and its buffers and images, and builds the source
   *
   * A buffer with no `uri` is a meshopt fallback: a placeholder for data that sits compressed in
   * another buffer. It gets an empty `ArrayBuffer` so `buffers` stays index-aligned with the file's
   * list until `normalizeMeshopt` drops it. Any other buffer without a `uri` is an error.
   * @param url - URL of the `.gltf` file; buffers and images resolve relative to it
   * @param _resolvedAsset - Unused
   * @param loader - The loader that loads and caches the images
   */
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

      const isMeshoptFallback =
        buffer.extensions?.EXT_meshopt_compression?.fallback === true ||
        buffer.extensions?.KHR_meshopt_compression?.fallback === true;

      if (isMeshoptFallback) {
        return new ArrayBuffer(0);
      }

      throw new Error('GLTF buffer has no URI');
    });

    const buffers = await Promise.all(bufferPromises);

    await normalizeMeshopt(json, buffers);

    const images = await loadImages(json.images || [], basePath, json, buffers, loader!);

    const source = await parseGltf(json, buffers, images.textures);

    source._imageUrls.push(...images.urls);

    return source;
  },
  /**
   * Unloads the images the file loaded, then destroys the source
   * @param source - The source `load` returned
   * @param _resolvedAsset - Unused
   * @param loader - The loader that cached the images
   */
  async unload(source: Scene3DSource, _resolvedAsset?: ResolvedAsset, loader?: Loader) {
    await loader!.unload(source._imageUrls);
    source.destroy();
  },
} satisfies LoaderParser<Scene3DSource>;
