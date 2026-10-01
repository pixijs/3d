import { Rectangle, Texture, TextureSource } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { BaseMaterial3D } from '~/materials/BaseMaterial3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { Vector3 } from '~/math/vector/Vector3';
import { Container3D } from '~/scene/Container3D';
import { Sprite3D } from '~/scene/Sprite3D';
import type { Sprite3DMaterialOptions, Sprite3DOptions } from '~/scene/Sprite3D';
import { updateTransformAndChildren3D } from '~/scene/utils/updateView3DTransforms';
import { View3D } from '~/scene/View3D';

/** A texture of a known pixel size with no image behind it, which is all a sprite needs to size itself from `orig` */
const makeTexture = (width: number, height: number): Texture =>
  new Texture({ source: new TextureSource({ width, height, resolution: 1 }) });

/**
 * A texture with no drawable extent, the shape a still-loading atlas frame has
 *
 * A `TextureSource` turns a zero width or height into 1, so the zero has to come from the frame,
 * which `orig` aliases.
 */
const makeEmptyTexture = (): Texture => {
  const texture = makeTexture(64, 32);
  texture.frame.width = 0;
  texture.frame.height = 0;
  texture.updateUvs();
  return texture;
};

/** Rebuilds the local matrix as the transform pass does and returns a copy of its elements */
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

  it('collapses only the X/Y columns for a texture with no extent, keeping Z so the cull sphere has a radius', () => {
    const sprite = new Sprite3D({ texture: makeEmptyTexture() });
    const e = localElements(sprite);

    expect(e[0]).toBe(0);
    expect(e[5]).toBe(0);
    expect(e[10]).toBeCloseTo(1);
  });
});

/**
 * Where quad-local point `(x, y, z)` lands in the parent, through the rebuilt local matrix
 *
 * Rounds to six places and adds 0 to turn -0 into 0, which `toEqual` tells apart.
 */
const landing = (sprite: Sprite3D, x: number, y: number, z: number): number[] => {
  sprite.updateLocalTransform();
  const p = new Vector3(x, y, z).applyAffineMatrix4(sprite.localTransform);

  return [p.x, p.y, p.z].map((v) => Math.round(v * 1e6) / 1e6 + 0);
};

describe('Sprite3D origin', () => {
  /** A 200 × 400 px texture, 2 × 4 world units at the default pixelSize, at x = 10; quad corners sit at ±0.5 */
  const options = { texture: makeTexture(200, 400), position: { x: 10, y: 0, z: 0 } };

  it('measures the origin in world size units, after the anchor and before scale', () => {
    /** Origin on the top-right corner, so a quarter turn about +Z leaves that corner at position + origin */
    const corner = new Sprite3D({ ...options, origin: { x: 1, y: 2, z: 0 } });
    corner.rotation.z = Math.PI / 2;

    expect(landing(corner, 0.5, 0.5, 0)).toEqual([11, 2, 0]);
    expect(landing(corner, 0, 0, 0)).toEqual([13, 1, 0]);

    /**
     * Stood on position by its anchor, with the origin 1 world unit along x, unscaled by `scale.x`. A
     * quarter turn about +Z with scale (2, 1, 1) runs quad +X along (0, 4, 0) and quad +Y along (-4, 0, 0).
     */
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
  /** A root's stand-in parent, like the transform pass's own: identity world transform and worldVisible 1 */
  const tempParent = new Container3D();
  let tick = 0;
  const runTransformPass = (node: Container3D) => updateTransformAndChildren3D(node, tempParent, ++tick, false, false);

  it('keeps the billboarded quad inside the world bounding sphere for any camera orientation', () => {
    const sprite = new Sprite3D({ texture: makeTexture(64, 200), anchor: { x: 0.5, y: 1 } });
    sprite.position.set(3, 0, -2);
    sprite.rotation.set(0.2, 0.9, 0.4);
    sprite.scale.set(1.7, 0.8, 1);
    runTransformPass(sprite);

    /** Sphere both backends cull with, centred on the translation column where billboard shaders rebuild the quad */
    const sphere = sprite.boundingSphere;
    const e = sprite.worldTransform.elements;

    expect(sphere.center.x).toBeCloseTo(e[12]);
    expect(sphere.center.y).toBeCloseTo(e[13]);
    expect(sphere.center.z).toBeCloseTo(e[14]);

    /**
     * The rebuilt quad's corners sit ±0.5·sx along the camera right and ±0.5·sy along its up, so
     * their reach is 0.5·hypot(sx, sy). The cull radius is √0.5 × the longest column, which never
     * falls below that reach, so billboarding is safe with the shared quad's bounds.
     */
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

    /** The 512 px texture's own width at the default pixelSize of 0.01 */
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

  it('shares one geometry across every sprite, whatever the mode', () => {
    const quad = PlaneGeometry.spriteQuad;
    const a = new Sprite3D({ texture: makeTexture(8, 8) });
    const b = new Sprite3D({ texture: makeTexture(16, 16), billboardMode: 'cylindrical' });

    expect(a.geometry).toBe(quad);
    expect(b.geometry).toBe(quad);
    expect(a.geometry.uid).toBe(b.geometry.uid);
  });

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

  it("routes 'blend' to the transparent pass and 'mask' to the opaque one", () => {
    const blended = new Sprite3D({ texture: makeTexture(8, 8) });
    const masked = new Sprite3D({ texture: makeTexture(8, 8), alphaMode: 'mask' });

    expect(blended.material.alphaMode).toBe('blend');
    expect(masked.material._passBit).not.toBe(blended.material._passBit);
  });

  it('never casts shadows by default, and re-evaluates its shadow bit itself when switched to blend', () => {
    const sprite = new Sprite3D({ texture: makeTexture(8, 8), alphaMode: 'mask', castShadow: true });
    expect(sprite.castShadow).toBe(true);
    const withShadow = sprite.renderPassBits;

    sprite.alphaMode = 'blend';
    expect(sprite.renderPassBits).not.toBe(withShadow);

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

  it('lets many sprites share one material without stealing each other’s image', () => {
    const shared = new Material3D({ baseColorTexture: makeTexture(64, 32) });
    const a = new Sprite3D({ material: shared });
    const b = new Sprite3D({ material: shared });

    expect(a.texture).toBe(b.texture);
    expect(a.material).toBe(b.material);
    expect(localElements(a)[0]).toBeCloseTo(0.64);
    expect(localElements(b)[0]).toBeCloseTo(0.64);
  });

  it('rejects material-shaping options at the type level, in both literal and pre-built form', () => {
    const material = () => new Material3D({ baseColorTexture: makeTexture(8, 8) });

    // @ts-expect-error — texture belongs to the self-contained form; the material's slot is authoritative
    const withTexture: Sprite3DOptions = { material: material(), texture: makeTexture(128, 64) };
    // @ts-expect-error — tint would write into a possibly-shared material
    const withTint: Sprite3DOptions = { material: material(), tint: 0xff0000 };
    // @ts-expect-error — alphaMode is the supplied material's own call
    const withAlphaMode: Sprite3DOptions = { material: material(), alphaMode: 'mask' };

    /** A pre-built bag skips excess-property checks, so only the options' `?: never` markers reject it */
    const bag = { material: material(), alpha: 0.5 };
    // @ts-expect-error — mixed pre-built options fail both forms
    const fromBag = () => new Sprite3D(bag);

    expect([withTexture, withTint, withAlphaMode, fromBag]).toBeDefined();
  });

  it('warns a plain-JS mixed bag and keeps the material authoritative', () => {
    const own = makeTexture(64, 32);
    const material = new Material3D({ baseColorTexture: own, baseColor: 0x224466, alpha: 0.25 });
    const warnSpy = vi.spyOn(console, 'warn');
    const isTwoFormsWarn = (c: unknown[]) => c.join(' ').includes('forms are exclusive');

    try {
      const sprite = new Sprite3D({
        material,
        texture: makeTexture(128, 64),
        tint: 0xff0000,
        alpha: 1,
      } as unknown as Sprite3DMaterialOptions);

      expect(warnSpy.mock.calls.some(isTwoFormsWarn)).toBe(true);
      expect(sprite.texture).toBe(own);
      expect(material.textures.baseColor).toBe(own);
      expect(sprite.tint).toBe(0x224466);
      expect(sprite.alpha).toBe(0.25);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('throws legibly when the material has no baseColor slot, such as a raw descriptor with no bits', () => {
    const material = new BaseMaterial3D({ descriptor: { bitsGpu: [], bitsGl: [] } });

    expect(() => new Sprite3D({ material })).toThrow(/baseColor/);
  });
});

describe('Sprite3D material passthroughs', () => {
  it('reads back tint, alpha and cutoff off the owned material', () => {
    const sprite = new Sprite3D({ texture: makeTexture(8, 8), tint: 0x3366ff, alpha: 0.25 });

    expect(sprite.tint).toBe(0x3366ff);
    expect(sprite.alpha).toBe(0.25);

    sprite.tint = 'red';
    sprite.alpha = 1;
    sprite.alphaCutoff = 0.75;

    expect(sprite.tint).toBe(0xff0000);
    expect(sprite.material.baseColor).toBe(0xff0000);
    expect(sprite.material.alpha).toBe(1);
    expect(sprite.material.alphaCutoff).toBe(0.75);
  });

  it('derives the UV transform from a framed texture: half the source each way, offset half across', () => {
    const source = new TextureSource({ width: 64, height: 64, resolution: 1 });
    const sprite = new Sprite3D({
      texture: new Texture({ source, frame: new Rectangle(32, 0, 32, 32) }),
    });

    expect(sprite.material.data.uvTransformRow0![0]).toBeCloseTo(0.5);
    expect(sprite.material.data.uvTransformRow0![3]).toBeCloseTo(0.5);
    expect(sprite.material.data.uvOffset![0]).toBeCloseTo(0.5);
    expect(sprite.material.data.uvOffset![1]).toBeCloseTo(0);
  });

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

    const anchorOf = (sprite: Sprite3D): number[] => [sprite.anchor.x, sprite.anchor.y];

    expect(anchorOf(new Sprite3D(texture))).toEqual([0.25, 1]);
    expect(anchorOf(new Sprite3D({ texture, anchor: 0 }))).toEqual([0, 0]);
    expect(anchorOf(new Sprite3D(makeTexture(8, 8)))).toEqual([0.5, 0.5]);
  });
});
