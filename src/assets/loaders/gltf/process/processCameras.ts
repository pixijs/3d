import type { Scene3DCamera, Scene3DDescriptor } from '../../../Scene3DDescriptor';
import type { GltfFormat } from '../GltfFormat';

/**
 * Converts glTF cameras into descriptor camera presets
 * @param gltfRaw - Parsed glTF JSON
 * @param descriptor - Receives the camera presets
 * @internal
 */
export function processCameras(gltfRaw: GltfFormat, descriptor: Scene3DDescriptor): void {
  if (!gltfRaw.cameras) {
    descriptor.cameras = [];

    return;
  }

  descriptor.cameras = gltfRaw.cameras.map((rawCamera) => {
    if (rawCamera.type === 'perspective') {
      const perspectiveData = rawCamera.perspective!;

      return {
        fov: perspectiveData.yfov,
        near: perspectiveData.znear,
        far: perspectiveData.zfar,
        aspectRatio: perspectiveData.aspectRatio,
        mode: 0,
      } as Scene3DCamera;
    }

    throw new Error('only perspective camera supported right now!');
  });
}
