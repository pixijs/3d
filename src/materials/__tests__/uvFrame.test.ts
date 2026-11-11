import { Matrix, Rectangle, Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { FlatMaterial } from '~/materials/flat/FlatMaterial';

function makeSource(): TextureSource {
  return new TextureSource({ width: 64, height: 64 });
}

function framed(source: TextureSource, x: number, y: number, w: number, h: number, rotate = 0): Texture {
  return new Texture({ source, frame: new Rectangle(x, y, w, h), rotate });
}

function expectFrameApplied(material: FlatMaterial, texture: Texture): void {
  const uvs = texture.uvs;
  expect(Array.from(material.data.uvTransformRow0!)).toEqual([
    uvs.x1 - uvs.x0,
    uvs.x3 - uvs.x0,
    uvs.y1 - uvs.y0,
    uvs.y3 - uvs.y0,
  ]);
  expect(Array.from(material.data.uvOffset!)).toEqual([uvs.x0, uvs.y0]);
}

describe('uv frame derivation', () => {
  it('re-derives and queues an upload on a frame swap, re-keying batches only when the source changes', () => {
    const source = makeSource();
    const material = new FlatMaterial({ baseColorTexture: framed(source, 0, 0, 32, 32) });
    const enqueued: unknown[] = [];
    material._uploadQueue = {
      enqueueDirty: (m) => void enqueued.push(m),
      remove: () => {},
      uniformResource: () => {
        throw new Error('no row is bound here');
      },
    };

    const dirtyId = material._descriptorDirtyId;

    const next = framed(source, 32, 32, 32, 32);
    material.textures.baseColor = next;

    expectFrameApplied(material, next);
    expect(material._descriptorDirtyId, 'same source: no re-key').toBe(dirtyId);
    expect(enqueued).toContain(material);

    material.textures.baseColor = framed(makeSource(), 0, 0, 32, 32);
    expect(material._descriptorDirtyId, 'new source: every mesh re-keys').toBeGreaterThan(dirtyId);
  });

  it('resets to identity when an unframed texture is assigned', () => {
    const source = makeSource();
    const material = new FlatMaterial({ baseColorTexture: framed(source, 0, 0, 16, 16) });

    material.textures.baseColor = new Texture({ source });

    expect(Array.from(material.data.uvTransformRow0!)).toEqual([1, 0, 0, 1]);
    expect(Array.from(material.data.uvOffset!)).toEqual([0, 0]);
  });

  it('honours GroupD8 rotation on a whole-source texture', () => {
    const texture = new Texture({ source: makeSource(), rotate: 2 });
    const material = new FlatMaterial({ baseColorTexture: texture });

    expectFrameApplied(material, texture);
    const row0 = material.data.uvTransformRow0!;
    expect(row0[1] !== 0 || row0[2] !== 0).toBe(true);
  });

  it('treats an identically-framed swap as a no-op with no row upload, even for a 1/3 UV that float32 rounds', () => {
    const source = new TextureSource({ width: 96, height: 96 });
    const material = new FlatMaterial({ baseColorTexture: framed(source, 32, 0, 32, 32) });
    const enqueued: unknown[] = [];
    material._uploadQueue = {
      enqueueDirty: (m) => void enqueued.push(m),
      remove: () => {},
      uniformResource: () => {
        throw new Error('no row is bound here');
      },
    };

    material.textures.baseColor = framed(source, 32, 0, 32, 32);

    expect(enqueued).toEqual([]);
  });

  it('explicit uvTransform wins over the frame and hands authorship back on clear', () => {
    const source = makeSource();
    const frameA = framed(source, 16, 16, 32, 32);
    const material = new FlatMaterial({
      baseColorTexture: frameA,
      uvTransform: new Matrix().translate(0.25, 0.5),
    });

    expect(Array.from(material.data.uvTransformRow0!)).toEqual([1, 0, 0, 1]);
    expect(Array.from(material.data.uvOffset!)).toEqual([0.25, 0.5]);
    expect(material.uvTransform).toBeDefined();

    material.textures.baseColor = framed(source, 0, 0, 16, 16);
    expect(Array.from(material.data.uvOffset!)).toEqual([0.25, 0.5]);

    material.uvTransform = undefined;
    expect(material.uvTransform).toBeUndefined();
    expectFrameApplied(material, material.textures.baseColor);
  });
});
