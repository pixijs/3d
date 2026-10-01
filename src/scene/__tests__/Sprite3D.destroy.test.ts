import { Texture, TextureSource } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { Sprite3D } from '~/scene/Sprite3D';

const makeTexture = (width = 8, height = 8): Texture =>
  new Texture({ source: new TextureSource({ width, height, resolution: 1 }) });

/** A `dynamic` texture, the only kind a sprite listens to for `update` */
const makeDynamicTexture = (width = 8, height = 8): Texture => {
  const texture = makeTexture(width, height);
  texture.dynamic = true;
  return texture;
};

/** Geometry3D's private `_destroyed` flag, typed for reading through a cast instead of `any` */
interface GeometryInternals {
  _destroyed: boolean;
}

describe('Sprite3D.destroy', () => {
  it('leaves the shared quad alive even under destroy(true), for the next sprite to draw', () => {
    const quad = PlaneGeometry.spriteQuad;
    const sprite = new Sprite3D({ texture: makeTexture() });

    sprite.destroy(true);

    expect((quad as unknown as GeometryInternals)._destroyed).toBe(false);
    expect(quad.buffers).not.toBe(null);
    expect(new Sprite3D({ texture: makeTexture() }).geometry).toBe(quad);
  });

  it('hands destroyed children the caller’s own options, so a child mesh still frees its own geometry', () => {
    const sprite = new Sprite3D({ texture: makeTexture() });
    const childGeometry = new SphereGeometry();
    const child = new Mesh3D({ geometry: childGeometry, material: new Material3D({ baseColor: 0x223344 }) });

    sprite.addChild(child);

    sprite.destroy({ children: true, geometry: true });

    expect(child.destroyed).toBe(true);
    expect((childGeometry as unknown as GeometryInternals)._destroyed).toBe(true);
    expect((PlaneGeometry.spriteQuad as unknown as GeometryInternals)._destroyed).toBe(false);
  });

  it('frees a child mesh entirely under destroy(true), quad still alive', () => {
    const sprite = new Sprite3D({ texture: makeTexture() });
    const childGeometry = new SphereGeometry();
    const childTexture = makeTexture();
    const childSource = childTexture.source;
    const childMaterial = new Material3D({ baseColorTexture: childTexture });

    sprite.addChild(new Mesh3D({ geometry: childGeometry, material: childMaterial }));

    sprite.destroy(true);

    expect((childGeometry as unknown as GeometryInternals)._destroyed).toBe(true);
    expect(childMaterial.destroyed).toBe(true);
    expect(childTexture.destroyed).toBe(true);
    expect(childSource.destroyed).toBe(true);
    expect((PlaneGeometry.spriteQuad as unknown as GeometryInternals)._destroyed).toBe(false);
  });

  it('frees nothing for `textureSource` on its own, matching 2D `Sprite`', () => {
    const texture = makeTexture();
    const source = texture.source;
    const shared = new Material3D({ baseColorTexture: texture });

    new Sprite3D({ material: shared }).destroy({ textureSource: true });

    expect(texture.destroyed).toBe(false);
    expect(source.destroyed).toBe(false);

    texture.destroy(true);
  });

  it('destroys the owned material even with no flags passed', () => {
    const sprite = new Sprite3D({ texture: makeTexture() });
    const material = sprite.material;

    sprite.destroy();

    expect(material.destroyed).toBe(true);
  });

  it('keeps a supplied material, which the caller may be sharing, unless `material` asks for it', () => {
    const shared = new Material3D({ baseColor: 0x336699, baseColorTexture: makeTexture() });
    const a = new Sprite3D({ material: shared });
    const b = new Sprite3D({ material: shared });

    a.destroy();

    expect(shared.destroyed).toBe(false);
    expect(b.material).toBe(shared);

    b.destroy({ material: true });
    expect(shared.destroyed).toBe(true);
  });

  it('keeps the texture unless `texture` asks for it', () => {
    const kept = makeTexture();
    const spriteA = new Sprite3D({ texture: kept });
    spriteA.destroy();
    expect(kept.destroyed).toBe(false);

    const freed = makeTexture();
    const freedSource = freed.source;
    const spriteB = new Sprite3D({ texture: freed });
    spriteB.destroy({ texture: true });
    expect(freed.destroyed).toBe(true);
    expect(freedSource.destroyed).toBe(false);

    const both = makeTexture();
    const bothSource = both.source;
    new Sprite3D({ texture: both }).destroy({ texture: true, textureSource: true });
    expect(both.destroyed).toBe(true);
    expect(bothSource.destroyed).toBe(true);
  });

  it('frees the texture but keeps a supplied material for `texture` alone', () => {
    const texture = makeTexture();
    const shared = new Material3D({ baseColorTexture: texture });

    new Sprite3D({ material: shared }).destroy({ texture: true });

    expect(shared.destroyed).toBe(false);
    expect(texture.destroyed).toBe(true);
  });

  it('frees a supplied material and its texture once under `material` + `texture`', () => {
    const texture = makeTexture();
    const shared = new Material3D({ baseColorTexture: texture });
    const textureDestroy = vi.spyOn(texture, 'destroy');

    new Sprite3D({ material: shared }).destroy({ material: true, texture: true });

    expect(shared.destroyed).toBe(true);
    expect(textureDestroy).toHaveBeenCalledTimes(1);
  });

  it('frees the texture source once under `material` + `texture` + `textureSource`', () => {
    const texture = makeTexture();
    const source = texture.source;
    const shared = new Material3D({ baseColorTexture: texture });
    const sourceDestroy = vi.spyOn(source, 'destroy');

    new Sprite3D({ material: shared }).destroy({ material: true, texture: true, textureSource: true });

    expect(shared.destroyed).toBe(true);
    expect(texture.destroyed).toBe(true);
    expect(source.destroyed).toBe(true);
    expect(sourceDestroy).toHaveBeenCalledTimes(1);
  });

  it('still frees the texture under `texture` when a supplied material was destroyed earlier', () => {
    const texture = makeTexture();
    const source = texture.source;
    const shared = new Material3D({ baseColorTexture: texture });
    const sprite = new Sprite3D({ material: shared });

    shared.destroy();
    sprite.destroy({ texture: true });

    expect(texture.destroyed).toBe(true);
    expect(source.destroyed).toBe(false);
  });

  it('still frees the texture under `texture` when its own material was destroyed earlier', () => {
    const texture = makeTexture();
    const source = texture.source;
    const sprite = new Sprite3D({ texture });

    sprite.material.destroy();
    sprite.destroy({ texture: true, textureSource: true });

    expect(texture.destroyed).toBe(true);
    expect(source.destroyed).toBe(true);
  });

  it('is idempotent', () => {
    const sprite = new Sprite3D({ texture: makeTexture() });

    expect(() => sprite.destroy(true)).not.toThrow();
    expect(() => sprite.destroy(true)).not.toThrow();
  });

  it('stops listening to its texture', () => {
    const texture = makeDynamicTexture();
    const sprite = new Sprite3D({ texture });

    expect(texture.listenerCount('update')).toBe(1);

    sprite.destroy();

    expect(texture.listenerCount('update')).toBe(0);
  });

  it('hands the listener over on a texture swap', () => {
    const first = makeDynamicTexture();
    const second = makeDynamicTexture(16, 16);
    const sprite = new Sprite3D({ texture: first });

    sprite.texture = second;

    expect(first.listenerCount('update')).toBe(0);
    expect(second.listenerCount('update')).toBe(1);

    sprite.destroy();
  });

  it('never subscribes to a static texture, matching 2D `Sprite`', () => {
    const texture = makeTexture();
    const sprite = new Sprite3D({ texture });

    expect(texture.listenerCount('update')).toBe(0);

    sprite.texture = makeTexture(16, 16);
    expect(sprite.texture.listenerCount('update')).toBe(0);

    sprite.destroy();
  });
});
