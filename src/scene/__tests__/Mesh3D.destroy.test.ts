import { Texture, TextureSource } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';

const makeTexture = (): Texture => new Texture({ source: new TextureSource({ width: 8, height: 8, resolution: 1 }) });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Mesh3D destroy', () => {
  it('keeps geometry and material by default (both are shared)', () => {
    const geometry = new SphereGeometry();
    const material = new Material3D({ baseColor: 0xff8844 });

    try {
      const mesh = new Mesh3D({ geometry, material });
      const geometryDestroy = vi.spyOn(geometry, 'destroy');
      const materialDestroy = vi.spyOn(material, 'destroy');

      mesh.destroy();

      expect(geometryDestroy).not.toHaveBeenCalled();
      expect(materialDestroy).not.toHaveBeenCalled();
      expect(mesh.destroyed).toBe(true);
    } finally {
      geometry.destroy(true);
    }
  });

  it('destroys geometry and material when both flags are set', () => {
    const geometry = new SphereGeometry();
    const material = new Material3D({ baseColor: 0xff8844 });
    const mesh = new Mesh3D({ geometry, material });

    const geometryDestroy = vi.spyOn(geometry, 'destroy');
    const materialDestroy = vi.spyOn(material, 'destroy');

    mesh.destroy({ geometry: true, material: true });

    expect(geometryDestroy).toHaveBeenCalledTimes(1);
    expect(geometryDestroy).toHaveBeenCalledWith(true);
    expect(materialDestroy).toHaveBeenCalledTimes(1);
  });

  it('keeps the material textures unless `texture` is set', () => {
    const geometry = new SphereGeometry();

    try {
      const kept = makeTexture();
      new Mesh3D({ geometry, material: new Material3D({ baseColorTexture: kept }) }).destroy({ material: true });
      expect(kept.destroyed).toBe(false);

      const freed = makeTexture();
      new Mesh3D({ geometry, material: new Material3D({ baseColorTexture: freed }) }).destroy({
        material: true,
        texture: true,
      });
      expect(freed.destroyed).toBe(true);
    } finally {
      geometry.destroy(true);
    }
  });

  it('leaves the material and its textures alone for `texture` without `material`', () => {
    const geometry = new SphereGeometry();
    const texture = makeTexture();
    const material = new Material3D({ baseColorTexture: texture });

    try {
      new Mesh3D({ geometry, material }).destroy({ texture: true });

      expect(material.destroyed).toBe(false);
      expect(texture.destroyed).toBe(false);
    } finally {
      geometry.destroy(true);
    }
  });

  it('destroys the material with its textures and sources under destroy(true)', () => {
    const texture = makeTexture();
    const source = texture.source;
    const material = new Material3D({ baseColorTexture: texture });

    new Mesh3D({ geometry: new SphereGeometry(), material }).destroy(true);

    expect(material.destroyed).toBe(true);
    expect(texture.destroyed).toBe(true);
    expect(source.destroyed).toBe(true);
  });

  it('does not destroy the material when only geometry is flagged', () => {
    const geometry = new SphereGeometry();
    const material = new Material3D({ baseColor: 0xff8844 });

    const materialDestroy = vi.spyOn(material, 'destroy');

    const mesh = new Mesh3D({ geometry, material });
    mesh.destroy({ geometry: true });

    expect(materialDestroy).not.toHaveBeenCalled();
  });

  it('clears the per-pass cache and nulls the destroyed flag bookkeeping', () => {
    const geometry = new SphereGeometry();
    const material = new Material3D({ baseColor: 0xff8844 });

    try {
      const mesh = new Mesh3D({ geometry, material });

      mesh._passCache[1] = {} as Mesh3D['_passCache'][number];

      expect(Object.keys(mesh._passCache)).toHaveLength(1);

      mesh.destroy();

      expect(Object.keys(mesh._passCache)).toHaveLength(0);
      expect(mesh.destroyed).toBe(true);
    } finally {
      geometry.destroy(true);
    }
  });

  it('does not double-destroy the geometry across repeated destroy calls', () => {
    const geometry = new SphereGeometry();
    const material = new Material3D({ baseColor: 0xff8844 });
    const mesh = new Mesh3D({ geometry, material });

    const geometryDestroy = vi.spyOn(geometry, 'destroy');

    mesh.destroy({ geometry: true });
    mesh.destroy({ geometry: true });

    expect(geometryDestroy).toHaveBeenCalledTimes(1);
  });
});
