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

/** A resourceless texture of a known pixel size — `orig` is all the sprite reads. */
const makeTexture = (width: number, height: number): Texture =>
  new Texture({ source: new TextureSource({ width, height, resolution: 1 }) });

/**
 * A texture with no drawable extent. pixi floors a `TextureSource` at 1x1, so
 * the zero has to come from the frame (which `orig` aliases) — the same shape a
 * still-loading atlas frame has.
 */
const makeEmptyTexture = (): Texture => {
  const texture = makeTexture(64, 32);
  texture.frame.width = 0;
  texture.frame.height = 0;
  texture.updateUvs();
  return texture;
};

/** Rebuilds the local matrix the way the transform pass does, then returns its elements. */
const localElements = (sprite: Sprite3D): Float32Array => {
  sprite.updateLocalTransform();
  return Float32Array.from(sprite.localTransform.elements);
};

describe('Sprite3D local transform', () => {
  it('appends texture size × pixelSize to the X/Y basis columns', () => {
    const sprite = new Sprite3D({ texture: makeTexture(64, 32) });
    const e = localElements(sprite);

    // 64px × 0.01 across, 32px × 0.01 up; Z is untouched user scale.
    expect(e[0]).toBeCloseTo(0.64);
    expect(e[5]).toBeCloseTo(0.32);
    expect(e[10]).toBeCloseTo(1);
  });

  it('honours pixelSize without touching scale', () => {
    const sprite = new Sprite3D({ texture: makeTexture(64, 32), pixelSize: 1 / 32 });
    const e = localElements(sprite);

    expect(e[0]).toBeCloseTo(2);
    expect(e[5]).toBeCloseTo(1);
    expect(sprite.scale.x).toBe(1);
    expect(sprite.scale.y).toBe(1);
  });

  it('multiplies the texture size by the node scale', () => {
    const sprite = new Sprite3D({ texture: makeTexture(100, 100) });
    sprite.scale.set(3, 0.5, 1);
    const e = localElements(sprite);

    expect(e[0]).toBeCloseTo(3);
    expect(e[5]).toBeCloseTo(0.5);
  });

  it('leaves the centred default anchor at the node origin', () => {
    const sprite = new Sprite3D({ texture: makeTexture(200, 400) });
    sprite.position.set(1, 2, 3);
    const e = localElements(sprite);

    expect(e[12]).toBeCloseTo(1);
    expect(e[13]).toBeCloseTo(2);
    expect(e[14]).toBeCloseTo(3);
  });

  it('stands the sprite on its origin at anchor.y = 1', () => {
    const sprite = new Sprite3D({ texture: makeTexture(200, 400), anchor: { x: 0.5, y: 1 } });
    const e = localElements(sprite);

    // 400px × 0.01 = 4 units tall, so the centre lifts by half of that.
    expect(e[12]).toBeCloseTo(0);
    expect(e[13]).toBeCloseTo(2);
  });

  it('puts the left edge on the origin at anchor.x = 0', () => {
    const sprite = new Sprite3D({ texture: makeTexture(200, 400), anchor: { x: 0, y: 0.5 } });
    const e = localElements(sprite);

    expect(e[12]).toBeCloseTo(1); // 200px × 0.01 = 2 units wide → half is 1
    expect(e[13]).toBeCloseTo(0);
  });

  it('shifts the anchor through a rotated basis, not along world axes', () => {
    const sprite = new Sprite3D({ texture: makeTexture(200, 400), anchor: { x: 0.5, y: 1 } });
    // 90° about +Z sends local +Y to world -X.
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

  it('resizes from a spritesheet frame, not the whole source', () => {
    const source = new TextureSource({ width: 128, height: 128, resolution: 1 });
    const sprite = new Sprite3D({
      texture: new Texture({ source, frame: new Rectangle(0, 0, 32, 64) }),
    });
    const e = localElements(sprite);

    expect(e[0]).toBeCloseTo(0.32);
    expect(e[5]).toBeCloseTo(0.64);
  });

  it('collapses to a zero-sized quad for a texture with no extent', () => {
    const sprite = new Sprite3D({ texture: makeEmptyTexture() });
    const e = localElements(sprite);

    expect(e[0]).toBe(0);
    expect(e[5]).toBe(0);
    // Only the X/Y columns collapse — the Z column keeps the user's scale, which
    // is what leaves the cull sphere with a small conservative radius.
    expect(e[10]).toBeCloseTo(1);
  });
});

/** Where quad-local point `(x, y, z)` lands in the parent, through the rebuilt local matrix */
const landing = (sprite: Sprite3D, x: number, y: number, z: number): number[] => {
  sprite.updateLocalTransform();
  const p = new Vector3(x, y, z).applyAffineMatrix4(sprite.localTransform);

  // `+ 0` turns -0 into 0, which toEqual treats as a different value.
  return [p.x, p.y, p.z].map((v) => Math.round(v * 1e6) / 1e6 + 0);
};

describe('Sprite3D origin', () => {
  // 200 × 400 px at the default pixelSize is 2 × 4 world units; quad corners sit at ±0.5.
  const options = { texture: makeTexture(200, 400), position: { x: 10, y: 0, z: 0 } };

  it('measures the origin in world size units, after the anchor and before scale', () => {
    // Origin at the top-right corner, turned 90° about +Z: the corner stays at position + origin.
    const corner = new Sprite3D({ ...options, origin: { x: 1, y: 2, z: 0 } });
    corner.rotation.z = Math.PI / 2;

    expect(landing(corner, 0.5, 0.5, 0)).toEqual([11, 2, 0]);
    expect(landing(corner, 0, 0, 0)).toEqual([13, 1, 0]);

    // Turned 90° about +Z with scale (2, 1, 1): quad +X moves by (0, 4, 0) per unit, quad +Y by (-4, 0, 0).
    // The anchor stands the sprite on position, and the origin holds still 1 unit along x from there
    // — a world unit, not a scaled one, though the quad point that sits on it moves with the scale.
    const anchored = new Sprite3D({ ...options, anchor: { x: 0.5, y: 1 }, origin: { x: 1, y: 0, z: 0 } });
    anchored.rotation.z = Math.PI / 2;
    anchored.scale.set(2, 1, 1);

    expect(landing(anchored, 0.5, 0, 0)).toEqual([9, 0, 0]);
    expect(landing(anchored, 0, 0, 0)).toEqual([9, -2, 0]);
  });

  it('leaves an unrotated, unscaled sprite in place when it gets an origin', () => {
    const sprite = new Sprite3D({ ...options, origin: { x: 1, y: 2, z: 0 } });

    expect(landing(sprite, 0, 0, 0)).toEqual([10, 0, 0]);
    expect(landing(sprite, 0.5, 0.5, 0)).toEqual([11, 2, 0]);
  });

  it('keeps the matrix finite for a texture with no extent', () => {
    const sprite = new Sprite3D({
      texture: makeEmptyTexture(),
      origin: { x: 1, y: 1, z: 0 },
      scale: { x: 3, y: 1, z: 1 },
    });
    const e = localElements(sprite);

    expect(Array.from(e).every(Number.isFinite)).toBe(true);
    // World size units don't depend on the texture, so scaling ×3 around the origin still moves the
    // node 2 units back on x.
    expect(Array.from(e.subarray(12, 15), (v) => v + 0)).toEqual([-2, 0, 0]);
  });
});

describe('Sprite3D cull bounds', () => {
  // Shape-equivalent to the production TEMP_PARENT_3D sentinel: identity world
  // transform, worldVisible = 1.
  const tempParent = new Container3D();
  let tick = 0;
  const runTransformPass = (node: Container3D) => updateTransformAndChildren3D(node, tempParent, ++tick, false, false);

  it('keeps the billboarded quad inside the world bounding sphere', () => {
    const sprite = new Sprite3D({ texture: makeTexture(64, 200), anchor: { x: 0.5, y: 1 } });
    sprite.position.set(3, 0, -2);
    sprite.rotation.set(0.2, 0.9, 0.4);
    sprite.scale.set(1.7, 0.8, 1);
    runTransformPass(sprite);

    const sphere = sprite.boundingSphere;
    const e = sprite.worldTransform.elements;

    // Both culls put the sphere centre on the matrix's translation column, which
    // is exactly where the billboard shaders rebuild the quad.
    expect(sphere.center.x).toBeCloseTo(e[12]);
    expect(sphere.center.y).toBeCloseTo(e[13]);
    expect(sphere.center.z).toBeCloseTo(e[14]);

    // Worst-case corner reach of the rebuilt quad, for ANY camera orientation:
    // the corners sit at ±0.5·sx along the camera right and ±0.5·sy along its up,
    // and the cull radius is √0.5 × the longest column. Equality only when
    // sx === sy, so this is tight but never violated — which is what makes
    // billboarding safe with per-geometry (not per-mesh) bounds.
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

    // 5.12 units == the texture's natural size at 100ppu, so scale returns to 1.
    sprite.width = 5.12;
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

  it('reads back positive under a mirrored scale', () => {
    const sprite = new Sprite3D({ texture: makeTexture(64, 32) });
    sprite.scale.x = -2;

    expect(sprite.width).toBeCloseTo(1.28);
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

  it('getSize and setSize agree with width and height', () => {
    const sprite = new Sprite3D({ texture: makeTexture(64, 32) });

    expect(sprite.getSize()).toEqual({ width: sprite.width, height: sprite.height, depth: 0 });

    sprite.setSize(2);
    expect(sprite.width).toBeCloseTo(2);
    expect(sprite.height).toBeCloseTo(2);

    sprite.setSize(4, 1);
    expect(sprite.getSize().width).toBeCloseTo(4);
    expect(sprite.getSize().height).toBeCloseTo(1);

    // The base signature takes a depth; a sprite accepts and ignores it.
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

  it('writes one axis at a time, matching 2D Sprite', () => {
    const sprite = new Sprite3D({ texture: makeTexture(64, 32) });

    sprite.height = 4;

    // Deliberately NOT aspect-preserving — the accessors are primitive, fitting
    // is a construction-time convenience.
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
    // Aspect preserved means one uniform scale factor across both axes.
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

  it('falls back to pixelSize when neither is given', () => {
    const sprite = new Sprite3D({ texture: makeTexture(128, 200), pixelSize: 1 / 64 });

    expect(sprite.width).toBeCloseTo(2);
    expect(sprite.height).toBeCloseTo(3.125);
    expect(sprite.scale.x).toBe(1);
  });

  it('overrides pixelSize for the fitted size', () => {
    // pixelSize would give 1.28 x 2; the explicit height wins and width follows aspect.
    const sprite = new Sprite3D({ texture: makeTexture(128, 200), pixelSize: 0.01, height: 10 });

    expect(sprite.height).toBeCloseTo(10);
    expect(sprite.width).toBeCloseTo((10 * 128) / 200);
  });

  it('fits to the frame, not the whole atlas source', () => {
    const source = new TextureSource({ width: 256, height: 256, resolution: 1 });
    const sprite = new Sprite3D({
      texture: new Texture({ source, frame: new Rectangle(0, 0, 32, 64) }),
      height: 4,
    });

    // 32x64 frame → 1:2, so a 4-unit height is 2 units wide. Sourcing the aspect
    // from the 256x256 atlas would have made it square.
    expect(sprite.width).toBeCloseTo(2);
    expect(sprite.height).toBeCloseTo(4);
  });

  it('appends the fitted size to the local transform', () => {
    const sprite = new Sprite3D({ texture: makeTexture(128, 200), height: 4 });
    const e = localElements(sprite);

    expect(e[0]).toBeCloseTo((4 * 128) / 200);
    expect(e[5]).toBeCloseTo(4);
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

  it('leaves the material descriptor identical across modes', () => {
    const keyOf = (sprite: Sprite3D) => sprite.material.getPrimaryDescriptor(view).keyGpu;

    const sphericalA = new Sprite3D({ texture: makeTexture(8, 8), tint: 0xff0000 });
    const sphericalB = new Sprite3D({ texture: makeTexture(32, 32), tint: 0x00ff00, alpha: 0.5 });
    const cylindrical = new Sprite3D({ texture: makeTexture(8, 8), billboardMode: 'cylindrical' });

    // Texture, tint and alpha all live in the material row, so they never split
    // the shader. Neither does the mode: billboarding is injected by the core from
    // `billboardMode` rather than composed into the material, which is what lets a
    // sprite take any material at all. The variant split happens one level up; see
    // billboardMode.test.ts.
    expect(keyOf(sphericalA)).toBe(keyOf(sphericalB));
    expect(keyOf(cylindrical)).toBe(keyOf(sphericalA));
  });

  it('carries the mode on the mesh, and re-batches when it changes', () => {
    const sprite = new Sprite3D({ texture: makeTexture(8, 8) });
    expect(sprite.billboardMode).toBe('spherical');

    sprite._batchDirty = false;
    sprite.billboardMode = 'cylindrical';

    expect(sprite.billboardMode).toBe('cylindrical');
    // Mode picks the shader variant, so the per-pass cache must rebuild.
    expect(sprite._batchDirty).toBe(true);

    // No-op writes stay free.
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

  it('never casts shadows by default, and drops the bit again when switched to blend', () => {
    const sprite = new Sprite3D({ texture: makeTexture(8, 8), alphaMode: 'mask', castShadow: true });
    expect(sprite.castShadow).toBe(true);
    const withShadow = sprite.renderPassBits;

    // Blend is excluded from the shadow pass regardless of intent — the sprite
    // has to re-evaluate it, since the material can't reach back.
    sprite.alphaMode = 'blend';
    expect(sprite.renderPassBits).not.toBe(withShadow);

    expect(new Sprite3D({ texture: makeTexture(8, 8) }).castShadow).toBe(false);
  });
});

describe('Sprite3D with a supplied material', () => {
  it('uses it instead of building a FlatMaterial, and reads its image', () => {
    const texture = makeTexture(64, 32);
    const material = new Material3D({ baseColorTexture: texture, baseColor: 0x224466, roughness: 0.4 });
    const sprite = new Sprite3D({ material, billboardMode: 'cylindrical' });

    expect(sprite.material).toBe(material);
    expect(sprite.texture).toBe(texture);
    // Billboarding rides on the mesh, so it composes with a lit material.
    expect(sprite.billboardMode).toBe('cylindrical');
    expect(sprite.material.lit).toBe(true);
    // And the material's image drives the size.
    expect(localElements(sprite)[0]).toBeCloseTo(0.64);
  });

  it('does not let class defaults overwrite the material it was handed', () => {
    const material = new Material3D({ baseColor: 0x224466, alpha: 0.25, alphaMode: 'mask' });
    const sprite = new Sprite3D({ material });

    // `tint` defaults to 0xffffff and `alphaMode` to 'blend' — neither may land.
    expect(sprite.tint).toBe(0x224466);
    expect(sprite.alpha).toBe(0.25);
    expect(sprite.alphaMode).toBe('mask');
  });

  it("reads the texture out of the material's slot rather than clobbering it", () => {
    const own = makeTexture(64, 32);
    const material = new Material3D({ baseColorTexture: own });
    const sprite = new Sprite3D({ material });

    // The material's own image is authoritative — a `Texture.WHITE` write here
    // would blank a configured material.
    expect(sprite.texture).toBe(own);
    expect(material.textures.baseColor).toBe(own);
    // And the sprite sized itself from it.
    expect(localElements(sprite)[0]).toBeCloseTo(0.64);
  });

  it('lets many sprites share one material without stealing each other’s image', () => {
    const shared = new Material3D({ baseColorTexture: makeTexture(64, 32) });
    const a = new Sprite3D({ material: shared });
    const b = new Sprite3D({ material: shared });

    expect(a.texture).toBe(b.texture);
    expect(a.material).toBe(b.material);
    // The whole point: N sprites, one material row, no per-sprite material.
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

    // The `?: never` markers are what keep a pre-built (non-literal) bag out too.
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
      // The untyped-caller shape — TypeScript forbids this mix outright.
      const sprite = new Sprite3D({
        material,
        texture: makeTexture(128, 64),
        tint: 0xff0000,
        alpha: 1,
      } as unknown as Sprite3DMaterialOptions);

      expect(warnSpy.mock.calls.some(isTwoFormsWarn)).toBe(true);
      // Nothing landed: slot, tint and alpha all kept the material's values.
      expect(sprite.texture).toBe(own);
      expect(material.textures.baseColor).toBe(own);
      expect(sprite.tint).toBe(0x224466);
      expect(sprite.alpha).toBe(0.25);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('throws legibly when the material has no baseColor slot', () => {
    // A raw descriptor with no texture-bearing bits — nowhere to put the image.
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

  it('derives the UV transform from a framed texture', () => {
    const source = new TextureSource({ width: 64, height: 64, resolution: 1 });
    const sprite = new Sprite3D({
      texture: new Texture({ source, frame: new Rectangle(32, 0, 32, 32) }),
    });

    // Half the atlas in each axis, offset half a source across.
    expect(sprite.material.data.uvTransformRow0![0]).toBeCloseTo(0.5);
    expect(sprite.material.data.uvTransformRow0![3]).toBeCloseTo(0.5);
    expect(sprite.material.data.uvOffset![0]).toBeCloseTo(0.5);
    expect(sprite.material.data.uvOffset![1]).toBeCloseTo(0);
  });

  it('re-derives the UV transform when the texture frame is edited in place', () => {
    const source = new TextureSource({ width: 64, height: 64, resolution: 1 });
    // `dynamic` is what buys the 'update' subscription, exactly as in 2D. Editing
    // a static texture's frame is the caller's to announce.
    const texture = new Texture({ source, frame: new Rectangle(0, 0, 64, 64), dynamic: true });
    const sprite = new Sprite3D({ texture });

    expect(sprite.material.data.uvTransformRow0![0]).toBeCloseTo(1);
    expect(localElements(sprite)[0]).toBeCloseTo(0.64);

    // Edited in place, as an animated spritesheet frame is — `orig` aliases
    // `frame`, so the sprite's size follows too.
    texture.frame.width = 16;
    texture.frame.height = 32;
    // No slot write happened, so the texture's own 'update' event is the only
    // signal the sprite gets.
    texture.update();

    expect(sprite.material.data.uvTransformRow0![0]).toBeCloseTo(0.25);
    expect(sprite.material.data.uvTransformRow0![3]).toBeCloseTo(0.5);
    expect(localElements(sprite)[0]).toBeCloseTo(0.16);
    expect(localElements(sprite)[5]).toBeCloseTo(0.32);
  });
});

describe('Sprite3D node options', () => {
  it("labels itself 'Sprite3D' unless given a label", () => {
    expect(new Sprite3D().label).toBe('Sprite3D');
    expect(new Sprite3D({ label: 'tree' }).label).toBe('tree');
  });

  it('forwards Mesh3D and Container3D options in both forms', () => {
    const own = new Sprite3D({ texture: makeTexture(8, 8), eventMode: 'static', position: { x: 1, y: 2, z: 3 } });
    expect(own.eventMode).toBe('static');
    expect(own.position.z).toBe(3);

    const shared = new Sprite3D({ material: new Material3D({ baseColorTexture: makeTexture(8, 8) }), visible: false });
    expect(shared.visible).toBe(false);
  });

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

  it('draws nothing for an alias the cache never saw, and still sizes cleanly', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const sprite = Sprite3D.from('pixi3d-never-loaded.png');

      // `Texture.from` returns the cache entry, which is missing here. 2D `Sprite.from` lands on
      // `Texture.EMPTY` for exactly this case, so a typo renders nothing; `new Sprite3D()` keeps
      // its own deliberate default of a white quad.
      expect(sprite.texture).toBe(Texture.EMPTY);
      expect(sprite.material.textures.baseColor).toBe(Texture.EMPTY);
      expect(new Sprite3D().texture).toBe(Texture.WHITE);

      // EMPTY measures 1x1, so the world-unit sizing path stays live — nothing divides by zero
      // and the size write is not dropped.
      expect(sprite.width).toBeCloseTo(0.01);
      sprite.width = 2;
      expect(sprite.width).toBeCloseTo(2);

      // The cache miss is pixi's own warning; the sprite never reports an unsized texture.
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
