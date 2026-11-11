import { describe, expect, it } from 'vitest';

import type { GltfFormat } from '~/assets/loaders/gltf/GltfFormat';
import { processMaterial, processMaterials } from '~/assets/loaders/gltf/process/processMaterials';
import { processNodes } from '~/assets/loaders/gltf/process/processNodes';
import type { Scene3DDescriptor } from '~/assets/Scene3DDescriptor';
import { Scene3DSource } from '~/assets/Scene3DSource';
import { Geometry3D } from '~/geometry/Geometry3D';
import type { Material3D } from '~/materials/pbr/Material3D';
import type { Mesh3D } from '~/scene/Mesh3D';
import { Model3D } from '~/scene/Model3D';

const noMaterialGltf = {
  asset: { version: '2.0' },
  scenes: [{ nodes: [0, 1] }],
  nodes: [
    { name: 'a', mesh: 0 },
    { name: 'b', mesh: 0 },
  ],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  materials: [{ name: 'Red', pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1], metallicFactor: 0 } }],
} as unknown as GltfFormat;

function load(gltf: GltfFormat): Scene3DSource {
  const descriptor: Scene3DDescriptor = { scenes: [{ children: [0, 1] }] };

  processNodes(gltf, descriptor);

  const source = new Scene3DSource(descriptor);

  source.geometries[0] = [new Geometry3D({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) })];
  processMaterials(gltf, source);

  return source;
}

describe('glTF default material', () => {
  it('gives a primitive with no material the spec default rather than material 0', () => {
    const source = load(noMaterialGltf);
    const mesh = Model3D.from(source).children[0] as Mesh3D;
    const material = mesh.material as Material3D;

    expect(material).toBe(source.materials[1]);
    expect(material.baseColor).toBe(0xffffff);
    expect(material.alpha).toBe(1);
    expect(material.metallic).toBe(1);
    expect(material.roughness).toBe(1);
    expect(material.alphaMode).toBe('opaque');
    expect(material.doubleSided).toBe(false);
  });

  it('shares one default material across every primitive that needs it', () => {
    const source = load(noMaterialGltf);
    const [a, b] = Model3D.from(source).children as Mesh3D[];

    expect(source.materials).toHaveLength(2);
    expect(a.material).toBe(b.material);
  });

  it('adds no default material when every primitive names one', () => {
    const gltf = {
      ...noMaterialGltf,
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    } as unknown as GltfFormat;
    const source = load(gltf);

    expect(source.materials).toHaveLength(1);
    expect((Model3D.from(source).children[0] as Mesh3D).material).toBe(source.materials[0]);
  });

  it('destroys the default material with the source', () => {
    const source = load(noMaterialGltf);
    const material = source.materials[1];

    source.destroy();

    expect(material.destroyed).toBe(true);
  });

  it('applies the spec metallic/roughness defaults to a material with no pbrMetallicRoughness', () => {
    const material = processMaterial({ name: 'Bare' }, new Scene3DSource({})) as Material3D;

    expect(material.metallic).toBe(1);
    expect(material.roughness).toBe(1);
    expect(material.baseColor).toBe(0xffffff);
  });
});
