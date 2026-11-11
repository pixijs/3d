import { RendererType } from 'pixi.js';
import type { Buffer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { MaterialDataStoreBuffer } from '~/core/buffers/MaterialDataStoreBuffer';
import type { BaseMaterial3D } from '~/materials/BaseMaterial3D';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';

const BYTES_PER_TEXEL = 16;

interface StoreProbe {
  _alignment: number;
  _buffer: Buffer | null;
  _retiredBuffers: Buffer[] | null;
}

const probe = (store: MaterialDataStoreBuffer): StoreProbe => store as unknown as StoreProbe;

const units = (material: BaseMaterial3D, alignment: number): number =>
  Math.ceil(material.data._f32.byteLength / alignment);

function registerUntilGrown(store: MaterialDataStoreBuffer): FlatMaterial[] {
  const version = store.bufferVersion;
  const materials: FlatMaterial[] = [];
  for (let i = 0; i < 100_000 && store.bufferVersion === version; i++) {
    const material = new FlatMaterial();
    store.register(material);
    materials.push(material);
  }
  expect(store.bufferVersion).toBe(version + 1);

  return materials;
}

for (const alignment of [256, 32]) {
  describe(`MaterialDataStoreBuffer places at alignment ${alignment}`, () => {
    const texelsPerUnit = alignment / BYTES_PER_TEXEL;

    it('gives materials of different struct sizes aligned places that do not overlap, each with a resource at its byte range', () => {
      const store = new MaterialDataStoreBuffer({ alignment, rendererType: RendererType.WEBGPU });
      const flat = new FlatMaterial();
      const pbr = new Material3D();
      expect(flat.data._f32.byteLength).not.toBe(pbr.data._f32.byteLength);

      store.register(flat);
      store.register(pbr);

      for (const material of [flat, pbr]) {
        expect(material._materialIndex % texelsPerUnit, 'a place starts on a unit').toBe(0);

        const resource = store.uniformResource(material);
        expect(store.uniformResource(material), 'one resource per material').toBe(resource);
        expect(resource.offset).toBe(material._materialIndex * BYTES_PER_TEXEL);
        expect(resource.size).toBe(units(material, alignment) * alignment);
        expect(resource.size).toBeGreaterThanOrEqual(material.data._f32.byteLength);
        expect(resource.buffer.data, 'the buffer views the store array').toBe(store.data);
      }

      const flatEnd = flat._materialIndex + units(flat, alignment) * texelsPerUnit;
      expect(pbr._materialIndex, 'the second place starts past the first').toBeGreaterThanOrEqual(flatEnd);
      expect(store.uniformResource(flat).buffer).toBe(store.uniformResource(pbr).buffer);

      store.destroy();
      flat.destroy();
      pbr.destroy();
    });

    it('remove() frees the place for the next material of that length, and a material that comes back at a new place gets a fresh resource', () => {
      const store = new MaterialDataStoreBuffer({ alignment, rendererType: RendererType.WEBGPU });
      const a = new Material3D();
      const b = new FlatMaterial();
      store.register(a);
      store.register(b);
      const index = a._materialIndex;
      const resource = store.uniformResource(a);

      store.remove(a);
      expect(a._materialIndex).toBe(-1);
      expect(a._uniformResource, 'the store keeps no list; the stale resource stays on the material').toBe(resource);
      expect(resource.destroyed).toBe(false);

      const c = new Material3D();
      store.register(c);
      expect(c._materialIndex).toBe(index);
      const fresh = store.uniformResource(c);
      expect(fresh).not.toBe(resource);
      expect(fresh.offset).toBe(index * BYTES_PER_TEXEL);

      store.register(a);
      expect(a._materialIndex).not.toBe(index);
      const again = store.uniformResource(a);
      expect(again, 'a stale resource is replaced on the next call').not.toBe(resource);
      expect(resource.destroyed, 'and the stale one is destroyed so a holder re-keys').toBe(true);
      expect(again.offset).toBe(a._materialIndex * BYTES_PER_TEXEL);
      expect(store.uniformResource(a), 'and then kept').toBe(again);

      store.destroy();
      a.destroy();
      b.destroy();
      c.destroy();
    });

    it('destroy() frees the buffer and the retired buffers, a second call does nothing, and the material lets its resource go', () => {
      const store = new MaterialDataStoreBuffer({ alignment, rendererType: RendererType.WEBGPU });
      const material = new Material3D();
      store.register(material);
      const retired = store.uniformResource(material).buffer;
      const filler = registerUntilGrown(store);
      const resource = store.uniformResource(material);
      const other = store.uniformResource(filler[0]);
      const live = resource.buffer;

      store.destroy();

      expect(retired.destroyed, 'the GC never frees a retired buffer, so destroy has to').toBe(true);
      expect(live.destroyed).toBe(true);
      expect(resource.destroyed, 'the store owns no resource; the buffer under it is gone').toBe(false);
      expect(other.destroyed).toBe(false);
      expect(probe(store)._buffer).toBeNull();
      expect(probe(store)._retiredBuffers).toBeNull();
      expect(store.data).toBeNull();
      expect(() => store.destroy()).not.toThrow();

      material.destroy();
      expect(material._uniformResource, 'the material releases its resource with itself').toBeNull();
      expect(resource.destroyed).toBe(true);
      for (const m of filler) m.destroy();
      expect(other.destroyed).toBe(true);
    });
  });
}

describe('MaterialDataStoreBuffer construction', () => {
  it.each([
    [8, 16],
    [24, 48],
    [32, 32],
    [256, 256],
  ])('rounds a device alignment of %s up to a unit of %s bytes, a whole number of texels', (alignment, unit) => {
    const store = new MaterialDataStoreBuffer({ alignment, rendererType: RendererType.WEBGPU });
    const a = new FlatMaterial();
    const b = new FlatMaterial();
    store.register(a);
    store.register(b);

    expect(probe(store)._alignment).toBe(unit);
    expect(store.uniformResource(b).offset % unit, 'the second place starts on the unit').toBe(0);
    expect(store.uniformResource(b).offset % BYTES_PER_TEXEL).toBe(0);
    expect(store.uniformResource(a).size % unit).toBe(0);

    store.destroy();
    a.destroy();
    b.destroy();
  });
});
