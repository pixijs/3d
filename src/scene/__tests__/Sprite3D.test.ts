import { Rectangle, Texture, TextureSource } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { BaseMaterial3D } from '~/materials/BaseMaterial3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { Vector3 } from '~/math/vector/Vector3';
import { Container3D } from '~/scene/Container3D';
import { Sprite3D } from '~/scene/Sprite3D';
import type { Sprite3DOptions } from '~/scene/Sprite3D';
import { updateTransformAndChildren3D } from '~/scene/utils/updateView3DTransforms';
import { View3D } from '~/scene/View3D';

const makeTexture = (width: number, height: number): Texture =>
  new Texture({ source: new TextureSource({ width, height, resolution: 1 }) });

const makeEmptyTexture = (): Texture => {
  const texture = makeTexture(64, 32);
  texture.frame.width = 0;
  texture.frame.height = 0;
  texture.updateUvs();
  return texture;
};

const localElements = (sprite: Sprite3D): Float32Array => {
  sprite.updateLocalTransform();
  return Float32Array.from(sprite.localTransform.elements);
};

describe('Sprite3D local transform', () => {
  it('scales the X/Y basis columns by texture size × pixelSize (0.01 by default), leaving Z at the user scale', () => {
    const sprite = new Sprite3D({ texture: makeTexture(64, 32) });
    const e = localElements(sprite);

    expect(e[0]).toBeCloseTo(0.64);
    expect(e[5]).toBeCloseTo(0.32);
    expect(e[10]).toBeCloseTo(1);
  });

  it('stands the sprite on its origin at anchor.y = 1, lifting its centre by half its 4-unit height', () => {
    const sprite = new Sprite3D({ texture: makeTexture(200, 400), anchor: { x: 0.5, y: 1 } });
    const e = localElements(sprite);

    expect(e[12]).toBeCloseTo(0);
    expect(e[13]).toBeCloseTo(2);
  });

  it('shifts the anchor through a rotated basis: a quarter turn about +Z moves the lift onto -X', () => {
    const sprite = new Sprite3D({ texture: makeTexture(200, 400), anchor: { x: 0.5, y: 1 } });
    sprite.rotation.z = Math.PI / 2;
    const e = localElements(sprite);

    expect(e[12]).toBeCloseTo(-2);
    expect(e[13]).toBeCloseTo(0);
  });

  it('is idempotent — repeated rebuilds never compound the size', () => {
    const sprite = new Sprite3D({ texture: makeTexture(64, 32), anchor: { x: 0.2, y: 0.8 } });
    sprite.position.set(1, 2, 3);
    sprite.rotation.set(0.3, 0.4, 0.5);

    const first = localElements(sprite);
    const second = localElements(sprite);
    const third = localElements(sprite);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('resizes from the new texture on swap', () => {
    const sprite = new Sprite3D({ texture: makeTexture(64, 32) });
    expect(localElements(sprite)[0]).toBeCloseTo(0.64);

    sprite.texture = makeTexture(256, 128);
    const e = localElements(sprite);

    expect(e[0]).toBeCloseTo(2.56);
    expect(e[5]).toBeCloseTo(1.28);
  });
});

const landing = (sprite: Sprite3D, x: number, y: number, z: number): number[] => {
  sprite.updateLocalTransform();
  const p = new Vector3(x, y, z).applyAffineMatrix4(sprite.localTransform);

  return [p.x, p.y, p.z].map((v) => Math.round(v * 1e6) / 1e6 + 0);
};

describe('Sprite3D origin', () => {
  const options = { texture: makeTexture(200, 400), position: { x: 10, y: 0, z: 0 } };

  it('measures the origin in world size units, after the anchor and before scale', () => {
    const corner = new Sprite3D({ ...options, origin: { x: 1, y: 2, z: 0 } });
    corner.rotation.z = Math.PI / 2;

    expect(landing(corner, 0.5, 0.5, 0)).toEqual([11, 2, 0]);
    expect(landing(corner, 0, 0, 0)).toEqual([13, 1, 0]);

    const anchored = new Sprite3D({ ...options, anchor: { x: 0.5, y: 1 }, origin: { x: 1, y: 0, z: 0 } });
    anchored.rotation.z = Math.PI / 2;
    anchored.scale.set(2, 1, 1);

    expect(landing(anchored, 0.5, 0, 0)).toEqual([9, 0, 0]);
    expect(landing(anchored, 0, 0, 0)).toEqual([9, -2, 0]);
  });

  it('keeps the matrix finite for a texture with no extent, and still scales about the origin in world units', () => {
    const sprite = new Sprite3D({
      texture: makeEmptyTexture(),
      origin: { x: 1, y: 1, z: 0 },
      scale: { x: 3, y: 1, z: 1 },
    });
    const e = localElements(sprite);

    expect(Array.from(e).every(Number.isFinite)).toBe(true);
    expect(Array.from(e.subarray(12, 15), (v) => v + 0)).toEqual([-2, 0, 0]);
  });
});

describe('Sprite3D cull bounds', () => {
  const tempParent = new Container3D();
  let tick = 0;
  const runTransformPass = (node: Container3D) => updateTransformAndChildren3D(node, tempParent, ++tick, false, false);

  it('keeps the billboarded quad inside the world bounding sphere for any camera orientation', () => {
    const sprite = new Sprite3D({ texture: makeTexture(64, 200), anchor: { x: 0.5, y: 1 } });
    sprite.position.set(3, 0, -2);
    sprite.rotation.set(0.2, 0.9, 0.4);
    sprite.scale.set(1.7, 0.8, 1);
    runTransformPass(sprite);

    const sphere = sprite.boundingSphere;
    const e = sprite.worldTransform.elements;

    expect(sphere.center.x).toBeCloseTo(e[12]);
    expect(sphere.center.y).toBeCloseTo(e[13]);
    expect(sphere.center.z).toBeCloseTo(e[14]);

    const sx = Math.hypot(e[0], e[1], e[2]);
    const sy = Math.hypot(e[4], e[5], e[6]);
    expect(0.5 * Math.hypot(sx, sy)).toBeLessThanOrEqual(sphere.radius + 1e-5);
  });
});

describe('Sprite3D observable purity', () => {
  it('keeps texture size out of scale across swaps and width writes', () => {
    const sprite = new Sprite3D({ texture: makeTexture(64, 32) });

    expect(sprite.scale.x).toBe(1);
    expect(sprite.scale.y).toBe(1);

    sprite.texture = makeTexture(512, 256);
    expect(sprite.scale.x).toBe(1);
    expect(sprite.scale.y).toBe(1);

    const naturalWidth = 5.12;
    sprite.width = naturalWidth;
    expect(sprite.scale.x).toBeCloseTo(1);

    sprite.position.set(4, 5, 6);
    expect(sprite.position.x).toBe(4);
    expect(sprite.position.y).toBe(5);
    expect(sprite.position.z).toBe(6);
  });
});

describe('Sprite3D width / height', () => {
  it('round-trips through scale in world units', () => {
    const sprite = new Sprite3D({ texture: makeTexture(64, 32) });

    expect(sprite.width).toBeCloseTo(0.64);
    expect(sprite.height).toBeCloseTo(0.32);

    sprite.width = 2;
    sprite.height = 4;

    expect(sprite.width).toBeCloseTo(2);
    expect(sprite.height).toBeCloseTo(4);
    expect(sprite.scale.x).toBeCloseTo(2 / 0.64);
    expect(sprite.scale.y).toBeCloseTo(4 / 0.32);
  });

  it('tracks pixelSize changes', () => {
    const sprite = new Sprite3D({ texture: makeTexture(64, 32) });
    sprite.pixelSize = 1 / 32;

    expect(sprite.width).toBeCloseTo(2);
    expect(sprite.height).toBeCloseTo(1);
  });

  it('drops the write on a texture with no extent', () => {
    const sprite = new Sprite3D({ texture: makeEmptyTexture() });

    sprite.width = 5;
    sprite.height = 5;

    expect(sprite.scale.x).toBe(1);
    expect(sprite.scale.y).toBe(1);
  });

  it('keeps a mirrored axis mirrored when its width is written', () => {
    const sprite = new Sprite3D({ texture: makeTexture(64, 32) });
    sprite.scale.x = -1;

    sprite.width = 1.28;

    expect(sprite.scale.x).toBeCloseTo(-2);
    expect(sprite.width).toBeCloseTo(1.28);
  });

  it('getSize and setSize agree with width and height, and ignore depth', () => {
    const sprite = new Sprite3D({ texture: makeTexture(64, 32) });

    expect(sprite.getSize()).toEqual({ width: sprite.width, height: sprite.height, depth: 0 });

    sprite.setSize(2);
    expect(sprite.width).toBeCloseTo(2);
    expect(sprite.height).toBeCloseTo(2);

    sprite.setSize(4, 1);
    expect(sprite.getSize().width).toBeCloseTo(4);
    expect(sprite.getSize().height).toBeCloseTo(1);

    sprite.setSize(5, 2, 9);
    expect(sprite.getSize().width).toBeCloseTo(5);
    expect(sprite.getSize().height).toBeCloseTo(2);
    expect(sprite.getSize().depth).toBe(0);
    expect(sprite.scale.z).toBe(1);

    sprite.setSize({ width: 3 });
    expect(sprite.width).toBeCloseTo(3);
    expect(sprite.height).toBeCloseTo(3);
    expect(sprite.scale.z).toBe(1);
  });

  it('writes one axis at a time, matching 2D Sprite; only the construction options keep the aspect', () => {
    const sprite = new Sprite3D({ texture: makeTexture(64, 32) });

    sprite.height = 4;

    expect(sprite.height).toBeCloseTo(4);
    expect(sprite.width).toBeCloseTo(0.64);
    expect(sprite.scale.x).toBe(1);
  });
});

describe('Sprite3D construction width / height', () => {
  it('fits width from height, preserving the texture aspect', () => {
    const sprite = new Sprite3D({ texture: makeTexture(128, 200), height: 4 });

    expect(sprite.height).toBeCloseTo(4);
    expect(sprite.width).toBeCloseTo((4 * 128) / 200);
    expect(sprite.scale.x).toBeCloseTo(sprite.scale.y);
  });

  it('fits height from width, preserving the texture aspect', () => {
    const sprite = new Sprite3D({ texture: makeTexture(128, 200), width: 2 });

    expect(sprite.width).toBeCloseTo(2);
    expect(sprite.height).toBeCloseTo((2 * 200) / 128);
    expect(sprite.scale.x).toBeCloseTo(sprite.scale.y);
  });

  it('stretches to exactly the box when both are given', () => {
    const sprite = new Sprite3D({ texture: makeTexture(128, 200), width: 3, height: 1 });

    expect(sprite.width).toBeCloseTo(3);
    expect(sprite.height).toBeCloseTo(1);
    expect(sprite.scale.x).not.toBeCloseTo(sprite.scale.y);
  });

  it('fits to the 1:2 frame, not the square atlas source', () => {
    const source = new TextureSource({ width: 256, height: 256, resolution: 1 });
    const sprite = new Sprite3D({
      texture: new Texture({ source, frame: new Rectangle(0, 0, 32, 64) }),
      height: 4,
    });

    expect(sprite.width).toBeCloseTo(2);
    expect(sprite.height).toBeCloseTo(4);
  });

  it('drops the fit on a texture with no extent', () => {
    const sprite = new Sprite3D({ texture: makeEmptyTexture(), height: 4 });

    expect(sprite.scale.x).toBe(1);
    expect(sprite.scale.y).toBe(1);
  });
});

describe('Sprite3D batching identity', () => {
  const view = new View3D({ width: 64, height: 64 });

  it('keeps one shader key across texture, tint, alpha and billboard mode, which the core injects per mesh', () => {
    const keyOf = (sprite: Sprite3D) => sprite.material.getPrimaryDescriptor(view).keyGpu;

    const sphericalA = new Sprite3D({ texture: makeTexture(8, 8), tint: 0xff0000 });
    const sphericalB = new Sprite3D({ texture: makeTexture(32, 32), tint: 0x00ff00, alpha: 0.5 });
    const cylindrical = new Sprite3D({ texture: makeTexture(8, 8), billboardMode: 'cylindrical' });

    expect(keyOf(sphericalA)).toBe(keyOf(sphericalB));
    expect(keyOf(cylindrical)).toBe(keyOf(sphericalA));
  });

  it('carries the mode on the mesh, and re-batches when it changes but not on a same-value write', () => {
    const sprite = new Sprite3D({ texture: makeTexture(8, 8) });
    expect(sprite.billboardMode).toBe('spherical');

    sprite._batchDirty = false;
    sprite.billboardMode = 'cylindrical';

    expect(sprite.billboardMode).toBe('cylindrical');
    expect(sprite._batchDirty).toBe(true);

    sprite._batchDirty = false;
    sprite.billboardMode = 'cylindrical';
    expect(sprite._batchDirty).toBe(false);
  });

  it('never casts shadows by default, and stops casting when switched to blend', () => {
    const sprite = new Sprite3D({ texture: makeTexture(8, 8), alphaMode: 'mask', castShadow: true });
    expect(sprite.castShadow).toBe(true);
    expect(sprite.renderPassMask & RenderPassBit.SHADOW).not.toBe(0);

    sprite.alphaMode = 'blend';
    expect(sprite.renderPassMask & RenderPassBit.SHADOW).toBe(0);

    expect(new Sprite3D({ texture: makeTexture(8, 8) }).castShadow).toBe(false);
  });
});

describe('Sprite3D with a supplied material', () => {
  it('uses it instead of building a FlatMaterial, billboards it even when lit, and sizes from its image', () => {
    const texture = makeTexture(64, 32);
    const material = new Material3D({ baseColorTexture: texture, baseColor: 0x224466, roughness: 0.4 });
    const sprite = new Sprite3D({ material, billboardMode: 'cylindrical' });

    expect(sprite.material).toBe(material);
    expect(sprite.texture).toBe(texture);
    expect(sprite.billboardMode).toBe('cylindrical');
    expect(sprite.material.lit).toBe(true);
    expect(localElements(sprite)[0]).toBeCloseTo(0.64);
  });

  it("does not let the class defaults (white tint, 'blend') overwrite the material it was handed", () => {
    const material = new Material3D({ baseColor: 0x224466, alpha: 0.25, alphaMode: 'mask' });
    const sprite = new Sprite3D({ material });

    expect(sprite.tint).toBe(0x224466);
    expect(sprite.alpha).toBe(0.25);
    expect(sprite.alphaMode).toBe('mask');
  });

  it('writes a texture passed with a material into its baseColor slot and sizes from it', () => {
    const material = new Material3D({ baseColorTexture: makeTexture(8, 8) });
    const texture = makeTexture(64, 32);
    const options: Sprite3DOptions = { material, texture };
    const warnSpy = vi.spyOn(console, 'warn');

    try {
      const sprite = new Sprite3D(options);

      expect(sprite.texture).toBe(texture);
      expect(material.textures.baseColor).toBe(texture);
      expect(localElements(sprite)[0]).toBeCloseTo(0.64);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('writes tint, alpha, alphaMode and alphaCutoff passed with a material into it', () => {
    const material = new Material3D({ baseColorTexture: makeTexture(8, 8), baseColor: 0x224466, alpha: 0.25 });
    const sprite = new Sprite3D({ material, tint: 'red', alpha: 0.5, alphaMode: 'mask', alphaCutoff: 0.3 });

    expect(sprite.material).toBe(material);
    expect(material.baseColor).toBe(0xff0000);
    expect(material.alpha).toBe(0.5);
    expect(material.alphaMode).toBe('mask');
    expect(material.alphaCutoff).toBe(0.3);
  });

  it('throws legibly when the material has no baseColor slot, such as a raw descriptor with no bits', () => {
    const material = new BaseMaterial3D({ descriptor: { bitsGpu: [], bitsGl: [] } });

    expect(() => new Sprite3D({ material })).toThrow(/baseColor/);
  });
});

describe('Sprite3D material passthroughs', () => {
  it("re-derives the UV transform and size on 'update' from a dynamic texture whose frame changed in place", () => {
    const source = new TextureSource({ width: 64, height: 64, resolution: 1 });
    const texture = new Texture({ source, frame: new Rectangle(0, 0, 64, 64), dynamic: true });
    const sprite = new Sprite3D({ texture });

    expect(sprite.material.data.uvTransformRow0![0]).toBeCloseTo(1);
    expect(localElements(sprite)[0]).toBeCloseTo(0.64);

    texture.frame.width = 16;
    texture.frame.height = 32;
    texture.update();

    expect(sprite.material.data.uvTransformRow0![0]).toBeCloseTo(0.25);
    expect(sprite.material.data.uvTransformRow0![3]).toBeCloseTo(0.5);
    expect(localElements(sprite)[0]).toBeCloseTo(0.16);
    expect(localElements(sprite)[5]).toBeCloseTo(0.32);
  });
});

describe('Sprite3D node options', () => {
  it('fits its size and joins a live parent only once built', () => {
    const view = new View3D({ width: 64, height: 64 });
    const sprite = new Sprite3D({ texture: makeTexture(100, 50), height: 2, parent: view.root });

    expect(sprite.view3d).toBe(view);
    expect(sprite.width).toBeCloseTo(4);
    expect(sprite.height).toBeCloseTo(2);

    view.destroy();
  });
});

describe('Sprite3D texture shorthand', () => {
  it('takes a bare texture as `{ texture }`, like 2D Sprite', () => {
    const texture = makeTexture(64, 32);
    const sprite = new Sprite3D(texture);

    expect(sprite.texture).toBe(texture);
    expect(sprite.material.textures.baseColor).toBe(texture);
    expect(sprite.width).toBeCloseTo(0.64);
  });

  it('builds from a texture or a texture source with Sprite3D.from', () => {
    const texture = makeTexture(16, 16);
    expect(Sprite3D.from(texture).texture).toBe(texture);

    const source = new TextureSource({ width: 32, height: 8, resolution: 1 });
    const fromSource = Sprite3D.from(source);
    expect(fromSource.texture.source).toBe(source);
    expect(fromSource.width).toBeCloseTo(0.32);
  });

  it('falls back to Texture.EMPTY for an alias the cache never saw, as 2D Sprite.from does, sized 1×1', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const sprite = Sprite3D.from('pixi3d-never-loaded.png');

      expect(sprite.texture).toBe(Texture.EMPTY);
      expect(sprite.material.textures.baseColor).toBe(Texture.EMPTY);
      expect(new Sprite3D().texture).toBe(Texture.WHITE);

      expect(sprite.width).toBeCloseTo(0.01);
      sprite.width = 2;
      expect(sprite.width).toBeCloseTo(2);

      const warned = (text: string) => warnSpy.mock.calls.some((call) => call.join(' ').includes(text));
      expect(warned('no dimensions')).toBe(false);
      expect(warned('not found in the Cache')).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("falls back to the texture's defaultAnchor when no anchor is passed", () => {
    const texture = new Texture({
      source: new TextureSource({ width: 64, height: 32, resolution: 1 }),
      defaultAnchor: { x: 0.25, y: 1 },
    });

    const lit = new Material3D({ baseColorTexture: makeTexture(8, 8) });
    const anchorOf = (sprite: Sprite3D): number[] => [sprite.anchor.x, sprite.anchor.y];

    expect(anchorOf(new Sprite3D(texture))).toEqual([0.25, 1]);
    expect(anchorOf(new Sprite3D({ texture, anchor: 0 }))).toEqual([0, 0]);
    expect(anchorOf(new Sprite3D({ material: lit, texture }))).toEqual([0.25, 1]);
    expect(anchorOf(new Sprite3D(makeTexture(8, 8)))).toEqual([0.5, 0.5]);
  });
});
