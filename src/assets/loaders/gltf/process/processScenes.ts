import type { Scene3DDescriptor } from '../../../Scene3DDescriptor';
import type { GltfFormat } from '../GltfFormat';

/** @internal */
export function processScenes(gltfRaw: GltfFormat, descriptor: Scene3DDescriptor): void {
  if (!gltfRaw.scenes) return;

  descriptor.scenes = gltfRaw.scenes.map((sceneRaw) => ({
    children: sceneRaw.nodes,
    name: sceneRaw.name,
  }));

  if (gltfRaw.scene !== undefined && gltfRaw.scene < descriptor.scenes.length) {
    descriptor.defaultScene = gltfRaw.scene;
  }
}
