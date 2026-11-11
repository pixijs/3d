import { describe, expect, it } from 'vitest';

import type { GltfFormat } from '~/assets/loaders/gltf/GltfFormat';
import { parseGltf } from '~/assets/loaders/gltf/parseGltf';
import { Camera3D } from '~/scene/cameras/Camera3D';
import { Model3D } from '~/scene/Model3D';

function cameraGltf(camera: GltfFormat.Camera): GltfFormat {
  return {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Rig', camera: 0, translation: [0, 0, 5] }],
    cameras: [camera],
  };
}

describe('glTF cameras', () => {
  it('loads a perspective camera as a Camera3D at its node, in degrees', async () => {
    const source = await parseGltf(
      cameraGltf({ type: 'perspective', perspective: { yfov: Math.PI / 2, znear: 0.5, zfar: 50 } }),
    );

    const model = new Model3D(source);

    expect(model.cameras).toHaveLength(1);

    const [camera] = model.cameras;

    expect(camera).toBeInstanceOf(Camera3D);
    expect(camera.mode).toBe('perspective');
    expect(camera.fov).toBeCloseTo(90);
    expect(camera.near).toBe(0.5);
    expect(camera.far).toBe(50);
    expect(camera.position.z).toBe(5);
  });

  it('loads an orthographic camera with half its width as orthographicSize', async () => {
    const source = await parseGltf(
      cameraGltf({ type: 'orthographic', orthographic: { xmag: 4, ymag: 3, znear: 0.1, zfar: 20 } }),
    );

    const model = new Model3D(source);

    expect(model.cameras).toHaveLength(1);

    const [camera] = model.cameras;

    expect(camera.mode).toBe('orthographic');
    expect(camera.orthographicSize).toBe(4);
    expect(camera.near).toBe(0.1);
    expect(camera.far).toBe(20);
  });
});
