import { checkDataUrl, checkExtension, ExtensionType, warn } from 'pixi.js';
import type { Loader, LoaderParser, ResolvedAsset } from 'pixi.js';

import type { Scene3DSource } from '../../Scene3DSource';
import type { GltfFormat } from './GltfFormat';
import { normalizeMeshopt } from './meshopt/normalizeMeshopt';
import { parseGltf } from './parseGltf';
import { glbToGltf } from './utils/glbToGltf';
import { loadImages } from './utils/loadImages';

/**
 * Loads a GLB file (binary glTF: JSON + buffers + images packed into a single `.glb` container)
 * and returns a {@link Scene3DSource}
 *
 * `@pixi/3d` registers it with pixi's `Assets` on import. `Assets.unload(url)` destroys the source
 * and unloads every image the file referenced from the loader's cache, as pixi's spritesheets do
 * with their image, even when another loaded asset still uses one.
 *
 * Only the buffer packed in the container is loaded; a buffer the file keeps outside it is not
 * fetched, and the loader warns. Images the file keeps outside resolve relative to the `.glb` URL.
 * Compressed data decodes as it loads, as {@link loadGltf} describes. Use {@link loadGltf} for the
 * text `.gltf` form.
 * @example
 * ```ts
 * import { Assets } from 'pixi.js';
 * import { Model3D, type Scene3DSource } from '@pixi/3d';
 *
 * const source = await Assets.load<Scene3DSource>('robot.glb');
 * view3d.root.addChild(new Model3D(source));
 * ```
 * @category assets
 * @advanced
 */
export const loadGlb = {
  extension: {
    type: ExtensionType.LoadParser,
    name: 'loadGlb',
  },
  name: 'loadGlb',
  id: 'glb',
  test(url: string) {
    return checkDataUrl(url, 'model/gltf-binary') || checkExtension(url, '.glb');
  },
  async load(url: string, _resolvedAsset?: ResolvedAsset, loader?: Loader) {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();

    const basePath = url.substring(0, url.lastIndexOf('/') + 1);

    const { json, buffers } = glbToGltf(arrayBuffer);

    padContainerBuffers(json.buffers ?? [], buffers);

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

/**
 * Stands an empty `ArrayBuffer` in for every buffer the file declares after the one the container
 * carries
 *
 * The container holds only buffer 0. A later buffer is either a meshopt fallback, whose data sits
 * compressed in another buffer, or an external `.bin`, which this loader doesn't fetch and warns
 * about. Each still needs a slot so `buffers` stays index-aligned with the file's list.
 * @param declared - The buffers the glTF JSON declares
 * @param buffers - The buffers the container carries; padded in place to match `declared`
 */
function padContainerBuffers(declared: NonNullable<GltfFormat['buffers']>, buffers: ArrayBuffer[]): void {
  for (let i = buffers.length; i < declared.length; i++) {
    const isMeshoptFallback =
      declared[i].extensions?.EXT_meshopt_compression?.fallback === true ||
      declared[i].extensions?.KHR_meshopt_compression?.fallback === true;

    if (!isMeshoptFallback) {
      warn(
        `[pixi-3d] GLB buffer ${i} ("${declared[i].uri ?? 'no uri'}") lives outside the container; ` +
          `external GLB buffers are not loaded, so anything reading it will come back empty.`,
      );
    }

    buffers.push(new ArrayBuffer(0));
  }
}
