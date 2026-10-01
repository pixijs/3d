import type { Scene3DDescriptor } from '../../../Scene3DDescriptor';
import type { GltfFormat } from '../GltfFormat';

/**
 * Converts glTF scenes into descriptor scene entries
 *
 * The file's `scene` becomes the default scene. When the file has none, or names one that doesn't
 * exist, no default is set and {@link Model3D} shows the first scene; glTF leaves that choice to the
 * viewer.
 * @param gltfRaw - Parsed glTF JSON
 * @param descriptor - Receives the scene entries and the default scene index
 * @internal
 */
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
