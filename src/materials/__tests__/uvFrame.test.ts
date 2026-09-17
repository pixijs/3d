import { Matrix, Rectangle, Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { FlatMaterial } from '~/materials/flat/FlatMaterial';

function makeSource(): TextureSource {
  return new TextureSource({ width: 64, height: 64 });
}

function framed(source: TextureSource, x: number, y: number, w: number, h: number, rotate = 0): Texture {
  return new Texture({ source, frame: new Rectangle(x, y, w, h), rotate });
}

/** The derivation contract: row0 = the frame quad's uv edge vectors, offset = its top-left corner. */
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
  it('derives the transform from a framed baseColor texture at construction', () => {
    const texture = framed(makeSource(), 16, 32, 16, 16);
    const material = new FlatMaterial({ baseColorTexture: texture });

    expectFrameApplied(material, texture);
    expect(material.uvTransform).toBeUndefined(); // engine-authored, not explicit
  });

  it('re-derives on a frame swap without re-keying same-source batches', () => {
    const source = makeSource();
    const material = new FlatMaterial({ baseColorTexture: framed(source, 0, 0, 32, 32) });
    const enqueued: unknown[] = [];
    material._uploadQueue = { enqueueDirty: (m) => void enqueued.push(m), remove: () => {} };

    void material.textureCacheKey; // prime the cached batch key
    expect(material['_textureCacheKey']).not.toBe(-1);

    const next = framed(source, 32, 32, 32, 32);
    material.textures.baseColor = next;

    expectFrameApplied(material, next); // new frame landed in the row...
    expect(material['_textureCacheKey']).not.toBe(-1); // ...with no batch re-key (same source)
    expect(enqueued).toContain(material); // pure data — signalled the upload queue

    // A different source is a real binding change and re-keys as before.
    material.textures.baseColor = framed(makeSource(), 0, 0, 32, 32);
    expect(material['_textureCacheKey']).toBe(-1);
  });

  it('resets to identity when an unframed texture is assigned', () => {
    const source = makeSource();
    const material = new FlatMaterial({ baseColorTexture: framed(source, 0, 0, 16, 16) });

    material.textures.baseColor = new Texture({ source });

    expect(Array.from(material.data.uvTransformRow0!)).toEqual([1, 0, 0, 1]);
    expect(Array.from(material.data.uvOffset!)).toEqual([0, 0]);
  });

  it('encodes GroupD8-rotated frames via the uv edge vectors', () => {
    const texture = framed(makeSource(), 0, 32, 32, 32, 2); // 90° packer rotation
    const material = new FlatMaterial({ baseColorTexture: texture });

    expectFrameApplied(material, texture);
    // A 90° rotation must land in the off-diagonal 2x2 lanes.
    const row0 = material.data.uvTransformRow0!;
    expect(row0[1] !== 0 || row0[2] !== 0).toBe(true);
  });

  it('honours GroupD8 rotation on a whole-source texture', () => {
    // Rotation makes a texture framed even when the frame covers the source —
    // the identity shortcut must not discard it.
    const texture = new Texture({ source: makeSource(), rotate: 2 });
    const material = new FlatMaterial({ baseColorTexture: texture });

    expectFrameApplied(material, texture);
    const row0 = material.data.uvTransformRow0!;
    expect(row0[1] !== 0 || row0[2] !== 0).toBe(true);
  });

  it('treats an identically-framed swap as a pure no-op (float32-exact, no row upload)', () => {
    // 32/96 = 1/3 — not float32-representable, so this pins the f32 round-trip:
    // the stored row must compare equal to a freshly computed frame.
    const source = new TextureSource({ width: 96, height: 96 });
    const material = new FlatMaterial({ baseColorTexture: framed(source, 32, 0, 32, 32) });
    const enqueued: unknown[] = [];
    material._uploadQueue = { enqueueDirty: (m) => void enqueued.push(m), remove: () => {} };

    material.textures.baseColor = framed(source, 32, 0, 32, 32);

    expect(enqueued).toEqual([]); // same source, same frame — nothing to re-key or upload
  });

  it('explicit uvTransform wins over the frame and hands authorship back on clear', () => {
    const source = makeSource();
    const frameA = framed(source, 16, 16, 32, 32);
    const material = new FlatMaterial({
      baseColorTexture: frameA,
      uvTransform: new Matrix().translate(0.25, 0.5),
    });

    // Explicit values, not the frame.
    expect(Array.from(material.data.uvTransformRow0!)).toEqual([1, 0, 0, 1]);
    expect(Array.from(material.data.uvOffset!)).toEqual([0.25, 0.5]);
    expect(material.uvTransform).toBeDefined();

    // Frames assigned while explicit don't touch the row.
    material.textures.baseColor = framed(source, 0, 0, 16, 16);
    expect(Array.from(material.data.uvOffset!)).toEqual([0.25, 0.5]);

    // Clearing re-derives from whatever sits in the slot.
    material.uvTransform = undefined;
    expect(material.uvTransform).toBeUndefined();
    expectFrameApplied(material, material.textures.baseColor!);
  });
});
