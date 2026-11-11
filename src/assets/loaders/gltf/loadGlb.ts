import { checkDataUrl, checkExtension, ExtensionType, warn } from 'pixi.js';
import type { Loader, LoaderParser, ResolvedAsset } from 'pixi.js';

import type { Scene3DSource } from '../../Scene3DSource';
import type { GltfFormat } from './GltfFormat';
import { normalizeMeshopt } from './meshopt/normalizeMeshopt';
import { parseGltf } from './parseGltf';
import { glbToGltf } from './utils/glbToGltf';
import { loadImages } from './utils/loadImages';

/**
 * Loads a binary glTF (`.glb`) file as a {@link Scene3DSource}
 *
 * `@pixi/3d` registers it with `Assets` on import, and `Assets.unload(url)` frees the source as
 * {@link Scene3DSource#destroy} describes. Compressed data and texture formats load as
 * {@link loadGltf} describes.
 *
 * Only the buffer packed in the file loads: a buffer kept outside it isn't fetched, and the loader
 * warns. Images kept outside it resolve relative to the `.glb` URL.
 * @example
 * ```ts
 * import 'pixi.js/ktx2'; // only needed for models with KTX2 textures
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
  // oxlint-disable-next-line typescript/no-deprecated -- pixi's Loader._validateParsers keys parsers by name too, and reports an id conflict for each parser after the first that leaves it out
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

    const images = await loadImages(json, basePath, buffers, loader!);

    const source = await parseGltf(json, buffers, images.textures);

    source._imageUrls.push(...images.urls);

    return source;
  },
  /**
   * Keeps the order of `loadGltf.unload`, which says why
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
