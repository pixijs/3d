import { detectAvif, GlobalResourceRegistry } from 'pixi.js';
import type { Loader, Texture } from 'pixi.js';

import type { GltfFormat } from '../GltfFormat';

/** Cached per page; clearing the global resource registry resets it, so tests can fake it */
let avifSupport: Promise<boolean> | undefined;

GlobalResourceRegistry.register({
  clear: () => {
    avifSupport = undefined;
  },
});

interface LoadedImages {
  textures: Texture[];
  urls: string[];
}

/**
 * Lists each blob URL in `urls` though it's revoked, as it stays its texture's cache key. On a
 * failure it unloads what loaded, since the caller never receives those keys
 * @param json - Parsed glTF JSON; each texture's `source` is rewritten to the image it uses
 * @param basePath - URL prefix for relative image URIs
 * @param buffers - Holds embedded image bytes; a promise lets URI images load while it settles
 * @param loader - Loads each image as a texture
 * @internal
 */
export async function loadImages(
  json: GltfFormat,
  basePath: string,
  buffers: ArrayBuffer[] | Promise<ArrayBuffer[]>,
  loader: Loader,
): Promise<LoadedImages> {
  const images = json.images ?? [];
  const urls: string[] = [];
  const textures: Texture[] = [];

  const imagePromises = Array.from(await pickImages(json, loader), async ([index, parser]) => {
    const image = images[index];

    if (image.uri) {
      const src = image.uri.startsWith('data:') ? image.uri : basePath + image.uri;

      urls.push(src);

      textures[index] = await loader.load({ src, parser });
    } else if (image.bufferView !== undefined) {
      const src = await getBlobUrlForImage(image.bufferView, image.mimeType, json, await buffers);

      urls.push(src);

      try {
        textures[index] = await loader.load({ src, parser });
      } finally {
        URL.revokeObjectURL(src);
      }
    }
  });

  const results = await Promise.allSettled([...imagePromises, buffers]);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');

  if (failure) {
    await loader.unload(urls);
    throw failure.reason;
  }

  return { textures, urls };
}

/** Most preferred first; the KTX2 parser goes by id, as a data or blob URL has no `.ktx2` to match */
const IMAGE_EXTENSIONS = [
  { name: 'KHR_texture_basisu', parser: 'ktx2' },
  { name: 'EXT_texture_avif', parser: 'texture' },
  { name: 'EXT_texture_webp', parser: 'texture' },
] as const;

async function pickImages(json: GltfFormat, loader: Loader): Promise<Map<number, 'ktx2' | 'texture'>> {
  const parsers = new Map<number, 'ktx2' | 'texture'>();
  const textures = json.textures ?? [];
  const usable: Record<(typeof IMAGE_EXTENSIONS)[number]['name'], boolean> = {
    KHR_texture_basisu: loader.parsers.some((parser) => parser.id === 'ktx2'),
    EXT_texture_avif:
      textures.some((texture) => texture.extensions?.EXT_texture_avif) && (await (avifSupport ??= detectAvif.test())),
    EXT_texture_webp: true,
  };

  textures.forEach((texture, index) => {
    const extensions: NonNullable<GltfFormat.Texture['extensions']> = texture.extensions ?? {};
    const preferred = IMAGE_EXTENSIONS.find(({ name }) => usable[name] && extensions[name]);

    if (preferred) {
      texture.source = extensions[preferred.name]!.source;
      parsers.set(texture.source, preferred.parser);
    } else if (texture.source !== undefined) {
      parsers.set(texture.source, 'texture');
    } else if (extensions.KHR_texture_basisu) {
      throw new Error(
        `[@pixi/3d] glTF texture ${index} has only a KHR_texture_basisu (KTX2) image, which needs pixi's ` +
          `KTX2 loader: import 'pixi.js/ktx2' before loading the model`,
      );
    } else if (extensions.EXT_texture_avif) {
      throw new Error(
        `[@pixi/3d] glTF texture ${index} has only an EXT_texture_avif image, and this browser can't decode AVIF`,
      );
    } else {
      throw new Error(`[@pixi/3d] glTF texture ${index} has no PNG, JPEG, WebP, AVIF or KTX2 image`);
    }
  });

  return parsers;
}

async function getBlobUrlForImage(
  bufferViewIndex: number,
  mimeType: string | undefined,
  json: GltfFormat,
  buffers: ArrayBuffer[],
) {
  const bufferView = json.bufferViews![bufferViewIndex];
  const buffer = buffers[bufferView.buffer];

  const blob = new Blob([new Uint8Array(buffer, bufferView.byteOffset || 0, bufferView.byteLength)], {
    type: mimeType || 'image/png',
  });

  // oxlint-disable-next-line no-restricted-properties -- embedded GLB images are binary; the data: URL from pixijs#11599 would copy each texture through a base64 string
  return URL.createObjectURL(blob);
}
