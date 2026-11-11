import { checkDataUrl, checkExtension, ExtensionType } from 'pixi.js';
import type { Loader, LoaderParser, ResolvedAsset } from 'pixi.js';

import type { Scene3DSource } from '../../Scene3DSource';
import type { GltfFormat } from './GltfFormat';
import { normalizeMeshopt } from './meshopt/normalizeMeshopt';
import { parseGltf } from './parseGltf';
import { loadImages } from './utils/loadImages';

/**
 * Loads a `.gltf` file, with its external buffers and images, as a {@link Scene3DSource}
 *
 * `@pixi/3d` registers it with `Assets` on import, and `Assets.unload(url)` frees the source as
 * {@link Scene3DSource#destroy} describes. {@link loadGlb} loads the binary `.glb` form.
 *
 * Meshopt-compressed buffers (`EXT_meshopt_compression`, `KHR_meshopt_compression`) and
 * Draco-compressed meshes (`KHR_draco_mesh_compression`) decode as they load. Draco fetches its
 * decoder from the URLs {@link setDracoDecoderPath} sets.
 *
 * Each texture loads the first of its images the app supports, in this order:
 * - KTX2 (`KHR_texture_basisu`), once `import 'pixi.js/ktx2'` registers pixi's KTX2 loader. That
 *   loader fetches its transcoder from jsDelivr unless pixi's `setKTXTranscoderPath` sets other URLs.
 * - AVIF (`EXT_texture_avif`), in a browser that decodes it.
 * - WebP (`EXT_texture_webp`).
 * - The PNG or JPEG in its `source`.
 *
 * A texture with no image the app supports fails the load, with an error that says why.
 *
 * Two glTF texture features work with limits:
 * - Every texture samples the first UV set. One that asks for another, as some baked occlusion maps
 *   do, samples the first instead, and the loader warns.
 * - A material applies the first `KHR_texture_transform` it finds on its textures to all of them.
 * @example
 * ```ts
 * import 'pixi.js/ktx2'; // only needed for models with KTX2 textures
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
  // oxlint-disable-next-line typescript/no-deprecated -- pixi's Loader._validateParsers keys parsers by name too, and reports an id conflict for each parser after the first that leaves it out
  name: 'loadGltf',
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

      const isMeshoptFallback =
        buffer.extensions?.EXT_meshopt_compression?.fallback === true ||
        buffer.extensions?.KHR_meshopt_compression?.fallback === true;

      if (isMeshoptFallback) {
        return new ArrayBuffer(0);
      }

      throw new Error('GLTF buffer has no URI');
    });

    const buffersReady = Promise.all(bufferPromises).then(async (buffers) => {
      await normalizeMeshopt(json, buffers);

      return buffers;
    });

    const images = await loadImages(json, basePath, buffersReady, loader!);
    const source = await parseGltf(json, await buffersReady, images.textures);

    source._imageUrls.push(...images.urls);

    return source;
  },
  /**
   * Destroys the materials first, as pixi warns when a bound texture source is destroyed, then unloads
   * the images through the loader, as pixi also warns when a source `Assets` manages is destroyed directly
   * @param source - The source `load` returned
   * @param _resolvedAsset - Unused
   * @param loader - The loader that cached the images
   */
  async unload(source: Scene3DSource, _resolvedAsset?: ResolvedAsset, loader?: Loader) {
    for (const material of source.materials) material.destroy();
    await loader!.unload(source._imageUrls);
    source.destroy();
  },
} satisfies LoaderParser<Scene3DSource>;
