import type { Texture } from 'pixi.js';

import type { Scene3DDescriptor } from '../../Scene3DDescriptor';
import { Scene3DSource } from '../../Scene3DSource';
import type { GltfFormat } from './GltfFormat';
import { processAnimations } from './process/processAnimations';
import { processCameras } from './process/processCameras';
import { processLights } from './process/processLights';
import { processMaterials } from './process/processMaterials';
import { processMeshes } from './process/processMeshes';
import { processNodes } from './process/processNodes';
import { processScenes } from './process/processScenes';
import { processSkins } from './process/processSkins';
import { processTextures } from './process/processTextures';

/**
 * Skins read the nodes and materials read the textures, so each runs after what it reads
 * @internal
 */
export async function parseGltf(
  gltfRaw: GltfFormat,
  buffers: ArrayBuffer[] = [],
  images: Texture[] = [],
): Promise<Scene3DSource> {
  const descriptor: Scene3DDescriptor = {};

  processNodes(gltfRaw, descriptor);
  processScenes(gltfRaw, descriptor);
  processLights(gltfRaw, descriptor);
  processCameras(gltfRaw, descriptor);

  const source = new Scene3DSource(descriptor);

  processAnimations(gltfRaw, buffers, source);
  processSkins(gltfRaw, buffers, descriptor);
  processTextures(gltfRaw, images, source);
  await processMeshes(gltfRaw, buffers, source);
  processMaterials(gltfRaw, source);

  return source;
}
