import type { Scene3DDescriptor } from '../../../Scene3DDescriptor';
import type { GltfFormat } from '../GltfFormat';

/**
 * Converts glTF scenes into descriptor scene entries
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

  // glTF `scene` names the scene to display. It is optional — the spec leaves
  // the choice to the runtime when absent, and every major viewer shows the
  // first one, so the descriptor falls back to index 0.
  if (gltfRaw.scene !== undefined && gltfRaw.scene < descriptor.scenes.length) {
    descriptor.defaultScene = gltfRaw.scene;
  }
}
