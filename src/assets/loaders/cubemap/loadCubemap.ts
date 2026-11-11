import { checkExtension, CubeTexture, ExtensionType, path } from 'pixi.js';
import type { Loader, LoaderParser, ResolvedAsset, Texture } from 'pixi.js';

const FACE_KEYS = ['right', 'left', 'top', 'bottom', 'front', 'back'] as const;

type CubemapFaceKey = (typeof FACE_KEYS)[number];
type CubemapJson = Record<CubemapFaceKey, string>;

/**
 * Loads a `.cubemap` JSON file as a {@link CubeTexture}
 *
 * The JSON names an image for each of the six faces, relative to the `.cubemap` file:
 *
 * ```json
 * {
 *   "right": "specular_posx.jpg",
 *   "left":  "specular_negx.jpg",
 *   "top":   "specular_posy.jpg",
 *   "bottom":"specular_negy.jpg",
 *   "front": "specular_posz.jpg",
 *   "back":  "specular_negz.jpg"
 * }
 * ```
 *
 * `@pixi/3d` registers it with `Assets` on import. `Assets.unload(url)` destroys the cube and
 * unloads its six images from the loader's cache, even when another loaded asset still uses one.
 * @example
 * ```ts
 * import { Assets } from 'pixi.js';
 * import '@pixi/3d';
 *
 * const env = await Assets.load<CubeTexture>('environment.cubemap');
 * view3d.environment = env;
 * ```
 * @category assets
 * @advanced
 */
export const loadCubemap = {
  extension: {
    type: ExtensionType.LoadParser,
    name: 'loadCubemap',
  },
  // oxlint-disable-next-line typescript/no-deprecated -- pixi's Loader._validateParsers keys parsers by name too, and reports an id conflict for each parser after the first that leaves it out
  name: 'loadCubemap',
  id: 'cubemap',

  test(url: string) {
    return checkExtension(url, '.cubemap');
  },

  async load(url: string, _resolvedAsset?: ResolvedAsset, loader?: Loader) {
    const response = await fetch(url);
    const json: CubemapJson = await response.json();
    const basePath = url.substring(0, url.lastIndexOf('/') + 1);

    const faceEntries = await Promise.all(
      FACE_KEYS.map(async (key) => {
        const src = basePath + json[key];
        const texture: Texture = await loader!.load({ src, parser: 'texture' });

        return [key, texture] as const;
      }),
    );

    const faces = Object.fromEntries(faceEntries) as Record<CubemapFaceKey, Texture>;

    const filename = path.basename(url, '.cubemap');

    return CubeTexture.from({ faces, label: filename });
  },

  /**
   * Destroys the cube before unloading its faces, so it has stopped listening to them by then
   * @param cubeTexture - The cube texture `load` returned
   * @param _resolvedAsset - Unused
   * @param loader - The loader that cached the face textures
   */
  async unload(cubeTexture: CubeTexture, _resolvedAsset?: ResolvedAsset, loader?: Loader) {
    const faces = cubeTexture.source.faces;
    const faceUrls = FACE_KEYS.map((key) => faces[key]._sourceOrigin);

    cubeTexture.destroy(true);
    await loader!.unload(faceUrls);
  },
} satisfies LoaderParser<CubeTexture>;
