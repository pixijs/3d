import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

describe('Mesh3D options', () => {
  const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
  const material = new Material3D({});

  it("labels itself 'Mesh3D' unless given a label", () => {
    expect(new Mesh3D({ geometry, material }).label).toBe('Mesh3D');
    expect(new Mesh3D({ geometry, material, label: 'crate' }).label).toBe('crate');
    expect(new Mesh3D({ geometry, material, label: undefined }).label).toBe('Mesh3D');
  });

  it('forwards Container3D options to the base', () => {
    const mesh = new Mesh3D({ geometry, material, visible: false, position: { x: 1, y: 2, z: 3 } });

    expect(mesh.visible).toBe(false);
    expect([mesh.position.x, mesh.position.y, mesh.position.z]).toEqual([1, 2, 3]);
  });

  it('merges Mesh3D.defaultOptions under the options, skipping explicit undefined', () => {
    const saved = Mesh3D.defaultOptions.castShadow;
    Mesh3D.defaultOptions.castShadow = false;

    try {
      expect(new Mesh3D({ geometry, material }).castShadow).toBe(false);
      expect(new Mesh3D({ geometry, material, castShadow: true }).castShadow).toBe(true);
    } finally {
      Mesh3D.defaultOptions.castShadow = saved;
    }

    expect(new Mesh3D({ geometry, material, castShadow: undefined }).castShadow).toBe(true);
  });

  it('measures width / height / depth against its geometry', () => {
    const mesh = new Mesh3D({ geometry, material, width: 2, height: 3, depth: 4 });

    expect([mesh.scale.x, mesh.scale.y, mesh.scale.z]).toEqual([2, 3, 4]);
  });

  it('joins a live parent only once built', () => {
    const view = new View3D({ width: 64, height: 64 });
    const mesh = new Mesh3D({ geometry, material, parent: view.root });

    expect(mesh.parent).toBe(view.root);
    expect(mesh.view3d).toBe(view);
    expect(view.meshes.items).toContain(mesh);

    view.destroy();
  });
});
