import { RAD_TO_DEG } from 'pixi.js';

import type { Scene3DCamera, Scene3DDescriptor } from '../../../Scene3DDescriptor';
import type { GltfFormat } from '../GltfFormat';

/**
 * Drops `ymag` and `aspectRatio`, as the view's size sets the aspect; `xmag` is half the width, as
 * `orthographicSize` is
 * @internal
 */
export function processCameras(gltfRaw: GltfFormat, descriptor: Scene3DDescriptor): void {
  if (!gltfRaw.cameras) {
    descriptor.cameras = [];

    return;
  }

  descriptor.cameras = gltfRaw.cameras.map((rawCamera): Scene3DCamera => {
    if (rawCamera.type === 'perspective') {
      const perspectiveData = rawCamera.perspective!;

      return {
        fov: perspectiveData.yfov * RAD_TO_DEG,
        near: perspectiveData.znear,
        far: perspectiveData.zfar,
        mode: 0,
      };
    }

    const orthographicData = rawCamera.orthographic!;

    return {
      orthographicSize: orthographicData.xmag,
      near: orthographicData.znear,
      far: orthographicData.zfar,
      mode: 1,
    };
  });
}
