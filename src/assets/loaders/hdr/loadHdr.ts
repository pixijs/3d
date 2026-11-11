import { checkExtension, ExtensionType, path } from 'pixi.js';
import type { CubeTexture, LoaderParser, ResolvedAsset } from 'pixi.js';

import { equirectToCube } from './equirectToCube';
import { parseRadianceHdr } from './parseRadianceHdr';

/**
 * Options read from an `.hdr` asset's `data`
 * @category assets
 * @advanced
 */
export interface HdrAssetData {
  /**
   * Width of each cube face in texels, a power of two
   *
   * Defaults to a quarter of the panorama's width, rounded down to a power of two, from 16 to 512.
   * A 512 cube with its mips takes about 8.4 MB on the GPU and the same again in main memory, and
   * each doubling takes four times that. Raise it only where a sharper sky is worth the memory.
   */
  faceSize?: number;
}

function defaultFaceSize(width: number): number {
  return Math.min(512, Math.max(16, 2 ** Math.floor(Math.log2(width / 4))));
}

/**
 * Loads an equirectangular Radiance `.hdr` image as an HDR {@link CubeTexture}
 *
 * Use the cube as {@link View3D#environment}, {@link View3D#background}, or both. It keeps light
 * brighter than white, such as the sun, bright in reflections and in the sky.
 *
 * The conversion runs on the main thread while the asset loads: about 50 ms for a 1k panorama and
 * 150 ms for a 2k one on a fast desktop, longer on a phone. {@link HdrAssetData#faceSize} trades
 * memory for a sharper sky.
 *
 * The centre of the panorama faces +X, so a camera looking down -Z, as the default camera does, is
 * centred a quarter of the way in from the panorama's left edge. HDR panoramas are commonly shown
 * this way on the web.
 *
 * `@pixi/3d` registers it with `Assets` on import, and `Assets.unload(url)` destroys the cube and
 * its faces.
 * @example
 * ```ts
 * import { Assets } from 'pixi.js';
 * import type { CubeTexture } from 'pixi.js';
 * import '@pixi/3d';
 *
 * const sky = await Assets.load<CubeTexture>('studio_2k.hdr');
 * view3d.environment = sky;
 * view3d.background = sky;
 *
 * const sharp = await Assets.load<CubeTexture>({ src: 'sunset_4k.hdr', data: { faceSize: 1024 } });
 * ```
 * @category assets
 * @advanced
 */
export const loadHdr = {
  extension: {
    type: ExtensionType.LoadParser,
    name: 'loadHdr',
  },
  // oxlint-disable-next-line typescript/no-deprecated -- pixi's Loader._validateParsers keys parsers by name too, and reports an id conflict for each parser after the first that leaves it out
  name: 'loadHdr',
  id: 'hdr',

  test(url: string) {
    return checkExtension(url, '.hdr');
  },

  async load(url: string, resolvedAsset?: ResolvedAsset<HdrAssetData>) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`loadHdr: fetching ${url} failed with status ${response.status}.`);
    const image = parseRadianceHdr(await response.arrayBuffer());
    const faceSize = resolvedAsset?.data?.faceSize ?? defaultFaceSize(image.width);

    return equirectToCube(image, faceSize, path.basename(url, '.hdr'));
  },

  /**
   * Destroys the faces too, as destroying a cube's source only detaches them
   * @param cubeTexture - The cube texture `load` returned
   */
  unload(cubeTexture: CubeTexture) {
    const faces = Object.values(cubeTexture.source.faces);
    cubeTexture.destroy(true);
    for (const face of faces) face.destroy();
  },
} satisfies LoaderParser<CubeTexture>;
