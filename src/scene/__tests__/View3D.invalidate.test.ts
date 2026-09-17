import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const makeMesh = () =>
  new Mesh3D({ geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }), material: new FlatMaterial({}) });

describe('View3D view-wide shader invalidation', () => {
  // Removing a mesh leaves a persistent null hole in the scene batch's
  // StableList-backed items array; the invalidation walk must skip it.
  it('survives a removed mesh when a view-wide shader setting changes', () => {
    const view = new View3D({ width: 64, height: 64 });
    const keep = makeMesh();
    const gone = makeMesh();

    view.root.addChild(keep);
    view.root.addChild(gone);
    view.root.removeChild(gone);

    keep._batchDirty = false;

    expect(() => (view.toneMapping = 'none')).not.toThrow();
    expect(keep._batchDirty).toBe(true);
  });
});
