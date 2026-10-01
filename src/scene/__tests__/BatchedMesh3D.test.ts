import { Texture, TextureSource } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { View3D } from '~/scene/View3D';

const makeTexture = (): Texture => new Texture({ source: new TextureSource({ width: 8, height: 8, resolution: 1 }) });

describe('BatchedMesh3D options', () => {
  it('has no size options: slots are not children, so there are no bounds to size against', () => {
    // @ts-expect-error width, height and depth are omitted from BatchedMesh3DOptions
    const batched = new BatchedMesh3D({ size: 1, width: 2 });

    expect(batched.scale.x).toBe(1);
  });

  it('registers its batch with a live parent passed as an option', () => {
    const view = new View3D({ width: 64, height: 64 });
    const batched = new BatchedMesh3D({ size: 1, parent: view.root });

    expect(batched.view3d).toBe(view);
    expect(view._meshBatches).toContain(batched.batch);

    view.destroy();
  });
});

describe('BatchedMesh3D destroy', () => {
  it('destroys each shared slot material once, keeping textures unless `texture` is set', () => {
    const geometry = new CubeGeometry();
    const kept = makeTexture();
    const material = new Material3D({ baseColorTexture: kept });
    const materialDestroy = vi.spyOn(material, 'destroy');

    const batched = new BatchedMesh3D({ size: 2 });
    batched.setGeometryAt(0, geometry);
    batched.setGeometryAt(1, geometry);
    batched.setMaterialAt(0, material);
    batched.setMaterialAt(1, material);

    batched.destroy({ geometry: true, material: true });

    expect(materialDestroy).toHaveBeenCalledTimes(1);
    expect(material.destroyed).toBe(true);
    expect(kept.destroyed).toBe(false);
  });

  it('frees slot material textures under `material` + `texture`', () => {
    const freed = makeTexture();
    const batched = new BatchedMesh3D({ size: 1 });
    batched.setGeometryAt(0, new CubeGeometry());
    batched.setMaterialAt(0, new Material3D({ baseColorTexture: freed }));

    batched.destroy({ geometry: true, material: true, texture: true });

    expect(freed.destroyed).toBe(true);
  });
});
