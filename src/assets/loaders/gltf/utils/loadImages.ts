import type { Loader, Texture } from 'pixi.js';

import type { Image, GltfFormat } from '../GltfFormat';

/**
 * The textures {@link loadImages} loaded, plus the URLs it loaded them from
 * @internal
 */
export interface LoadedImages {
  /** One texture per glTF image, in image order */
  textures: Texture[];
  /** The URLs the textures were loaded from, which are the keys that unload them from the loader */
  urls: string[];
}

/**
 * Loads every glTF image (external URI, data URI, or embedded bufferView) as a texture
 * @param images - The glTF image entries to load
 * @param basePath - URL prefix for relative image URIs
 * @param json - Parsed glTF JSON, used to resolve embedded bufferViews
 * @param buffers - Binary buffers holding embedded image bytes
 * @param loader - Loads each image as a texture
 * @internal
 */
export async function loadImages(
  images: Image[],
  basePath: string,
  json: GltfFormat,
  buffers: ArrayBuffer[],
  loader: Loader,
): Promise<LoadedImages> {
  const urls: string[] = [];

  const imagePromises = images.map(async (image) => {
    if (image.uri) {
      const src = image.uri.startsWith('data:') ? image.uri : basePath + image.uri;

      urls.push(src);

      return loader.load({
        src,
        parser: 'texture',
      });
    } else if (image.bufferView !== undefined) {
      const src = await getBlobUrlForImage(image.bufferView, image.mimeType, json, buffers);

      urls.push(src);

      try {
        return await loader.load({
          src,
          parser: 'texture',
        });
      } finally {
        // The texture keeps the decoded image, so the blob URL has no further use. The loader still
        // caches the texture under it, which is the key that unloads it.
        URL.revokeObjectURL(src);
      }
    }
  });

  const results = await Promise.allSettled(imagePromises);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');

  if (failure) {
    // The images that did load sit in the loader's cache under keys the caller never receives, so
    // release them here. The loader has already dropped the failed one, so its key is a no-op.
    await loader.unload(urls);
    throw failure.reason;
  }

  return { textures: results.map((result) => (result as PromiseFulfilledResult<Texture>).value), urls };
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
