import { describe, expect, it } from 'vitest';

import type { GltfFormat } from '~/assets/loaders/gltf/GltfFormat';
import { parseGltf } from '~/assets/loaders/gltf/parseGltf';
import { Model3D } from '~/scene/Model3D';

function twoSceneGltf(defaultScene?: number): GltfFormat {
  return {
    asset: { version: '2.0' },
    scene: defaultScene,
    scenes: [
      { name: 'First', nodes: [0] },
      { name: 'Second', nodes: [1] },
    ],
    nodes: [{ name: 'inFirst' }, { name: 'inSecond' }],
  } as GltfFormat;
}

describe('glTF default scene', () => {
  it('instantiates the scene named by the file’s `scene` index', async () => {
    const source = await parseGltf(twoSceneGltf(1));

    const model = new Model3D(source);

    expect(model.children.map((child) => child.label)).toEqual(['inSecond']);
  });

  it('falls back to the first scene when `scene` is omitted', async () => {
    const source = await parseGltf(twoSceneGltf());

    const model = new Model3D(source);

    expect(model.children.map((child) => child.label)).toEqual(['inFirst']);
  });

  it('still honours an explicitly named scene over the default', async () => {
    const source = await parseGltf(twoSceneGltf(1));

    const model = new Model3D({ source, scene: 'First' });

    expect(model.children.map((child) => child.label)).toEqual(['inFirst']);
  });
});
