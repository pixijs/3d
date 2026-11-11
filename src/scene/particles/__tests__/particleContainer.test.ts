import { Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { ShaderBit } from '~/core/shader/ShaderBit';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Container3D } from '~/scene/Container3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { ParticleContainer3D } from '~/scene/particles/ParticleContainer3D';
import { packParticleColor } from '~/scene/particles/utils/packParticleColor';
import { packParticleFrames } from '~/scene/particles/utils/packParticleFrames';
import { ensureQuadBuffers } from '~/scene/particles/utils/particleGeometry';

function sheet(frames: number): Texture[] {
  const source = new TextureSource({ width: frames * 16, height: 16, resolution: 1 });

  return Array.from(
    { length: frames },
    (_, i) => new Texture({ source, frame: { x: i * 16, y: 0, width: 16, height: 16 } as never }),
  );
}

describe('ParticleContainer3D', () => {
  it('lays a written particle out across its four vertices and leaves its neighbours untouched', () => {
    const buffer = new ParticleContainer3D({ capacity: 4 });
    const { f32, u32, floatStride } = buffer.data;

    expect(floatStride).toBe(6);

    buffer.setParticleAt(2, 1, 2, 3, 0.5, 0.25, 0xff8040, 0.5);

    const base = 2 * 4 * floatStride;

    for (let v = 0; v < 4; v++) {
      const o = base + v * floatStride;

      expect([f32[o], f32[o + 1], f32[o + 2]]).toEqual([1, 2, 3]);
      expect(f32[o + 3]).toBe(0.5);
      expect(f32[o + 4]).toBe(0.25);
      expect(u32[o + 5]).toBe(packParticleColor(0xff8040, 0.5));
    }

    expect(f32[1 * 4 * floatStride + 3]).toBe(0);
    expect(f32[3 * 4 * floatStride + 3]).toBe(0);

    buffer.destroy();
  });

  it('packs colour as the authored rgb bytes, red in the low byte and alpha in the high one', () => {
    const white = packParticleColor(0xffffff, 1);

    expect(white).toBe(0xffffffff >>> 0);

    const tint = packParticleColor(0x806040, 1);

    expect(tint & 0xff).toBe(0x80);
    expect((tint >> 8) & 0xff).toBe(0x60);
    expect((tint >> 16) & 0xff).toBe(0x40);
    expect(tint >>> 24).toBe(255);
    expect(packParticleColor(0xffffff, 0) >>> 24).toBe(0);

    const red = packParticleColor(0xff0000, 1);

    expect(red & 0xff).toBe(255);
    expect((red >> 8) & 0xff).toBe(0);
    expect((red >> 16) & 0xff).toBe(0);
  });

  it('writes the selected packed frame into every vertex', () => {
    const frameCount = 4;
    const frame = 2;
    const buffer = new ParticleContainer3D({ capacity: 2, texture: sheet(frameCount) });
    const { u16, floatStride } = buffer.data;

    buffer.setParticleAt(0, 0, 0, 0, 1, 0, 0xffffff, 1, frame);

    for (let v = 0; v < 4; v++) {
      const h = (0 * 4 * floatStride + v * floatStride + 6) * 2;

      expect(u16[h]).toBe(Math.round((frame / frameCount) * 65535));
      expect(u16[h + 1]).toBe(0);
      expect(u16[h + 2]).toBe(Math.round((1 / frameCount) * 65535));
      expect(u16[h + 3]).toBe(65535);
    }

    buffer.destroy();
  });

  it('rejects frames that do not share a texture source', () => {
    const a = sheet(2);
    const b = sheet(2);

    expect(() => packParticleFrames([a[0], b[0]])).toThrow(/one texture source/);
  });

  it('uploads one range spanning every marked particle, then nothing until more are marked', () => {
    const buffer = new ParticleContainer3D({ capacity: 8 });
    const bytesPerParticle = 4 * buffer.data.vertexStride;

    buffer.markDirty(5, 5);
    buffer.markDirty(2, 3);

    const updates = recordUploads(buffer);

    buffer.upload();
    buffer.upload();

    const particlesTwoToFive = [4 * bytesPerParticle, 2 * bytesPerParticle];
    expect(updates).toEqual([particlesTwoToFive]);

    buffer.destroy();
  });

  it('uses 32-bit indices past the range 16-bit ones can address', () => {
    const small = new ParticleContainer3D({ capacity: 16384 });
    const large = new ParticleContainer3D({ capacity: 16385 });

    expect(small.geometry.indices).toBeInstanceOf(Uint16Array);
    expect(large.geometry.indices).toBeInstanceOf(Uint32Array);

    small.destroy();
    large.destroy();
  });

  it('refuses mesh-level billboarding, which would fight its own', () => {
    const buffer = new ParticleContainer3D({ capacity: 2, billboard: 'cylindrical' });

    buffer.billboardMode = 'spherical';
    expect(buffer.billboardMode).toBe('none');

    buffer.destroy();
  });

  it('rejects a capacity below one', () => {
    expect(() => new ParticleContainer3D({ capacity: 0 })).toThrow(/capacity/);
  });

  it('keeps a default under an explicit undefined and forwards the container options', () => {
    const buffer = new ParticleContainer3D({ capacity: undefined, space: undefined, cursor: 'pointer' });

    expect(buffer.capacity).toBe(ParticleContainer3D.defaultOptions.capacity);
    expect(buffer.space).toBe('world');
    expect(buffer.cursor).toBe('pointer');
    expect(buffer.castShadow).toBe(false);
    expect(buffer.label).toBe('ParticleContainer3D');

    const parent = new Container3D();
    const placed = new ParticleContainer3D({ label: 'sparks', parent, position: { x: 1, y: 2, z: 3 } });

    expect(placed.label).toBe('sparks');
    expect(placed.parent).toBe(parent);
    expect(placed.position.y).toBe(2);

    buffer.destroy();
    parent.destroy({ children: true });
  });

  it('has no size options: the quads take shape in the shader, so there are no bounds to size against', () => {
    // @ts-expect-error width, height and depth are omitted from ParticleContainer3DOptions
    const buffer = new ParticleContainer3D({ capacity: 1, width: 2 });

    expect(buffer.scale.x).toBe(1);

    buffer.destroy();
  });
});

function recordUploads(buffer: ParticleContainer3D): [number, number][] {
  const updates: [number, number][] = [];
  const vertexBuffer = buffer.geometry.attributes.aPosition.buffer;
  const original = vertexBuffer.update.bind(vertexBuffer);

  vertexBuffer.update = (size?: number, offset?: number) => {
    updates.push([size ?? -1, offset ?? -1]);
    original(size, offset);
  };

  return updates;
}

describe('ParticleContainer3D guards and state', () => {
  it('keeps blending off under mask and opaque, whatever blend mode is asked for', () => {
    const mask = new ParticleContainer3D({ capacity: 1, alphaMode: 'mask', blendMode: 'add' });
    const opaque = new ParticleContainer3D({ capacity: 1, alphaMode: 'opaque' });
    const blend = new ParticleContainer3D({ capacity: 1, blendMode: 'add' });

    expect(mask.material.state.blend).toBe(false);
    expect(opaque.material.state.blend).toBe(false);
    expect(blend.material.state.blend).toBe(true);
    expect(blend.material.state.blendMode).toBe('add');

    mask.blendMode = 'screen';
    expect(mask.material.state.blend).toBe(false);

    blend.blendMode = 'screen';
    expect(blend.material.state.blendMode).toBe('screen');

    mask.destroy();
    opaque.destroy();
    blend.destroy();
  });

  it('clear() marks the written range for the one upload, which a spawn in the same frame joins', () => {
    const buffer = new ParticleContainer3D({ capacity: 8 });
    const bytes = 4 * buffer.data.vertexStride;

    buffer.setParticleAt(5, 1, 2, 3, 1);
    buffer.upload();

    const updates = recordUploads(buffer);

    buffer.clear();
    expect(updates).toEqual([]);

    buffer.setParticleAt(7, 1, 2, 3, 1);
    buffer.upload();
    expect(updates).toEqual([[8 * bytes, 0]]);
    expect(buffer.data.f32[5 * 4 * buffer.data.floatStride + 3]).toBe(0);

    buffer.destroy();
  });

  it('marks the whole pool for a wrapped range and clamps one that overshoots', () => {
    const buffer = new ParticleContainer3D({ capacity: 8 });
    const bytes = 4 * buffer.data.vertexStride;
    const updates = recordUploads(buffer);

    buffer.markDirty(6, 1);
    buffer.upload();
    expect(updates).toEqual([[8 * bytes, 0]]);

    updates.length = 0;
    buffer.markDirty(-3, 12);
    buffer.upload();
    expect(updates).toEqual([[8 * bytes, 0]]);

    buffer.destroy();
  });

  it('refuses a slot outside the pool on every write path', () => {
    const buffer = new ParticleContainer3D({ capacity: 4 });

    expect(() => buffer.setParticleAt(4, 0, 0, 0, 1)).toThrow(/outside the pool/);
    expect(() => buffer.writePacked(-1, 0, 0, 0, 1, 0, 0)).toThrow(/outside the pool/);
    expect(() => buffer.setParticle(7, { aPosition: { x: 0, y: 0, z: 0 } })).toThrow(/outside the pool/);

    buffer.destroy();
  });

  it('refuses a fractional capacity and an empty frame list', () => {
    expect(() => new ParticleContainer3D({ capacity: 1.5 })).toThrow(/whole number/);
    expect(() => new ParticleContainer3D({ capacity: 2, texture: [] })).toThrow(/no frames/);
  });

  it('refuses more attributes than the GPU guarantees, naming the count', () => {
    const wide = {
      name: 'fourteen-attributes',
      attributes: Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`aExtra${i}`, 'float32'])),
    } satisfies ShaderBit;

    expect(() => new ParticleContainer3D({ capacity: 2, extraBits: [wide] })).toThrow(/18 vertex attributes/);
  });

  it('wraps and floors the frame a spawn picks', () => {
    const frames = sheet(4);
    const buffer = new ParticleContainer3D({ capacity: 4, texture: frames });
    const packed = packParticleFrames(frames);
    const at = buffer.data.offsets.aParticleUVFrame / 4;
    const windowAt = (slot: number): number => buffer.data.u16[(slot * 4 * buffer.data.floatStride + at) * 2];

    buffer.setParticleAt(0, 0, 0, 0, 1, 0, 0xffffff, 1, 5);
    buffer.setParticleAt(1, 0, 0, 0, 1, 0, 0xffffff, 1, -1);
    buffer.setParticleAt(2, 0, 0, 0, 1, 0, 0xffffff, 1, 2.9);

    expect(windowAt(0)).toBe(packed[1 * 4]);
    expect(windowAt(1)).toBe(packed[3 * 4]);
    expect(windowAt(2)).toBe(packed[2 * 4]);

    buffer.destroy();
  });

  it('binds the whole sheet for a flipbook and frees that wrapper with the container', () => {
    const frames = sheet(4);
    const buffer = new ParticleContainer3D({ capacity: 4, texture: frames });
    const bound = buffer.material.textures.baseColor as Texture;
    let destroyed = false;

    bound.once('destroy', () => {
      destroyed = true;
    });

    expect(bound).not.toBe(frames[0]);
    expect(bound.frame.width).toBe(frames[0].source.width);

    buffer.destroy();

    expect(destroyed).toBe(true);
    expect(frames[0].source.destroyed).toBe(false);
  });
});

describe('ParticleContainer3D shared quad buffers', () => {
  it('draws the corners and indices from one pair, each container its own prefix and vertex count', () => {
    const a = new ParticleContainer3D({ capacity: 8 });
    const b = new ParticleContainer3D({ capacity: 5 });

    expect(b.geometry.attributes.aUV.buffer).toBe(a.geometry.attributes.aUV.buffer);
    expect(b.geometry.indexBuffer).toBe(a.geometry.indexBuffer);
    expect(a.geometry.indexCount).toBe(8 * 6);
    expect(b.geometry.indexCount).toBe(5 * 6);
    expect(a.geometry.indices.length).toBeGreaterThanOrEqual(8 * 6);
    expect(a.geometry.vertexCount).toBe(8 * 4);
    expect(b.geometry.vertexCount).toBe(5 * 4);

    const corners = a.geometry.attributes.aUV.buffer;

    a.destroy();
    expect(corners.destroyed).toBe(false);
    expect(b.geometry.indexBuffer.destroyed).toBe(false);

    b.destroy();
  });

  it('grows the uncapped 32-bit pair in place for a bigger request, so every container sees the same buffers', () => {
    const pair = ensureQuadBuffers(20_000);
    const before = pair.capacity;
    const onlyContainer = new ParticleContainer3D({ capacity: 20_000 });
    let changes = 0;
    const onChange = (): void => void changes++;

    pair.corners.on('change', onChange);
    pair.indices.on('change', onChange);

    expect(ensureQuadBuffers(before + 1)).toBe(pair);
    expect(pair.capacity).toBeGreaterThanOrEqual(before * 2);
    expect(pair.indices.data).toBeInstanceOf(Uint32Array);
    expect(pair.indices.data.length).toBe(pair.capacity * 6);
    expect(pair.corners.data.length).toBe(pair.capacity * 4 * 4);
    expect(changes).toBe(2);

    expect(onlyContainer.geometry.indexBuffer).toBe(pair.indices);
    expect(onlyContainer.geometry.indices.length).toBe(pair.capacity * 6);
    expect(onlyContainer.geometry.indexCount).toBe(20_000 * 6);

    const alreadyCovered = before;
    expect(ensureQuadBuffers(alreadyCovered)).toBe(pair);
    expect(changes).toBe(2);

    pair.corners.off('change', onChange);
    pair.indices.off('change', onChange);
    onlyContainer.destroy();
    expect(pair.indices.destroyed).toBe(true);
  });
});

describe('ParticleContainer3D destroy cascade', () => {
  interface GeometryInternals {
    _destroyed: boolean;
  }

  const childMesh = () => {
    const geometry = new SphereGeometry();
    const texture = new Texture({ source: new TextureSource({ width: 8, height: 8, resolution: 1 }) });
    const material = new Material3D({ baseColorTexture: texture });

    return { mesh: new Mesh3D({ geometry, material }), geometry, texture, source: texture.source, material };
  };

  it('hands destroyed children the caller’s own options, so a child still frees the geometry it owns', () => {
    const container = new ParticleContainer3D({ capacity: 4 });
    const { mesh, geometry } = childMesh();

    container.addChild(mesh);
    container.destroy({ children: true, geometry: true });

    expect(mesh.destroyed).toBe(true);
    expect((geometry as unknown as GeometryInternals)._destroyed).toBe(true);
  });

  it('passes a boolean down as-is rather than collapsing it to { children }', () => {
    const container = new ParticleContainer3D({ capacity: 4 });
    const { mesh, geometry, texture, source, material } = childMesh();

    container.addChild(mesh);
    container.destroy(true);

    expect(mesh.destroyed).toBe(true);
    expect((geometry as unknown as GeometryInternals)._destroyed).toBe(true);
    expect(material.destroyed).toBe(true);
    expect(texture.destroyed).toBe(true);
    expect(source.destroyed).toBe(true);
  });
});
