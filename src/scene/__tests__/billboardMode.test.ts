import { getApp } from '@test-utils';
import { Texture, TextureSource } from 'pixi.js';
import type { Application, WebGLRenderer, WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { getMeshBillboardBit } from '~/core/shader/bits/meshBillboardBits';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Sprite3D } from '~/scene/Sprite3D';
import { View3D } from '~/scene/View3D';

const makeTexture = (): Texture => new Texture({ source: new TextureSource({ width: 8, height: 8, resolution: 1 }) });

/**
 * Compiled shader-cache keys
 *
 * Each key joins its bit names in bit-list order, so it shows which bits the core injected and in
 * what order.
 */
const shaderKeys = (app: Application<WebGLRenderer | WebGPURenderer>): string[] => [
  ...(app.renderer.material3d['_shaderCache'].keys() as Iterable<string>),
];

const billboardKeys = (app: Application<WebGLRenderer | WebGPURenderer>): string[] =>
  shaderKeys(app).filter((k) => k.includes('meshBillboard'));

describe('getMeshBillboardBit', () => {
  it('gives every (mode, lit) pair its own name — names are the cache identity', () => {
    const names = new Set(
      (['spherical', 'cylindrical'] as const).flatMap((mode) => [
        getMeshBillboardBit(mode, false).name,
        getMeshBillboardBit(mode, true).name,
      ]),
    );

    expect(names.size).toBe(4);
    expect(names).toContain('meshBillboardSpherical');
    expect(names).toContain('meshBillboardSphericalLit');
  });

  it('emits the normal rotation only for the lit variant, since an unlit shader never reads vNormal', () => {
    const unlit = getMeshBillboardBit('cylindrical', false);
    const lit = getMeshBillboardBit('cylindrical', true);

    expect(lit.gpu!.vertex!.afterTransform).toContain('worldNormal');
    expect(lit.gl!.vertex!.afterTransform).toContain('worldNormal');
    expect(unlit.gpu!.vertex!.afterTransform).not.toContain('worldNormal');
    expect(unlit.gl!.vertex!.afterTransform).not.toContain('worldNormal');
  });

  it("refuses 'none' — the caller skips injection instead", () => {
    expect(() => getMeshBillboardBit('none', false)).toThrow(/none/);
  });
});

describe('billboardMode injection', () => {
  const render = async (
    id: string,
    build: (view3d: View3D) => void,
  ): Promise<Application<WebGLRenderer | WebGPURenderer>> => {
    const app = await getApp<WebGLRenderer | WebGPURenderer>({ id, appOptions: { width: 128, height: 128 } });
    const view3d = new View3D({ width: 128, height: 128 });
    app.stage.addChild(view3d);
    view3d.camera.position.set(0, 0, 4);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
    build(view3d);
    app.render();
    return app;
  };

  it('injects nothing for mode none', async () => {
    const app = await render('billboard-none', (view3d) => {
      view3d.root.addChild(new Sprite3D({ texture: makeTexture(), billboardMode: 'none' }));
    });
    try {
      expect(billboardKeys(app)).toHaveLength(0);
    } finally {
      app.destroy();
    }
  });

  it('injects the unlit variant, with no normal rotation, for an unlit material', async () => {
    const app = await render('billboard-unlit', (view3d) => {
      view3d.root.addChild(new Sprite3D({ texture: makeTexture(), billboardMode: 'spherical' }));
    });
    try {
      const keys = billboardKeys(app);
      expect(keys).toHaveLength(1);
      expect(keys[0]).toContain('meshBillboardSpherical');
      expect(keys[0]).not.toContain('meshBillboardSphericalLit');
    } finally {
      app.destroy();
    }
  });

  it('composes with a lit PBR material and picks the lit variant', async () => {
    const app = await render('billboard-lit', (view3d) => {
      const light = new DirectionalLight({ color: 0xffffff, intensity: 3 });
      light.rotation.set(-0.6, 0.6, 0);
      view3d.root.addChild(light);

      view3d.root.addChild(
        new Sprite3D({
          billboardMode: 'cylindrical',
          material: new Material3D({
            baseColorTexture: makeTexture(),
            baseColor: 0xff8844,
            roughness: 0.5,
            alphaMode: 'mask',
          }),
        }),
      );
    });
    try {
      const keys = billboardKeys(app);
      expect(keys).toHaveLength(1);
      expect(keys[0]).toContain('meshBillboardCylindricalLit');
      expect(keys[0]).toMatch(/pbr/i);
    } finally {
      app.destroy();
    }
  });

  it('is injected before the fog bit, which reads the billboarded worldPosition in the same vertex slot', async () => {
    const app = await getApp<WebGLRenderer | WebGPURenderer>({
      id: 'billboard-fog',
      appOptions: { width: 128, height: 128 },
    });
    try {
      const view3d = new View3D({
        width: 128,
        height: 128,
        fog: { type: 'linear', color: 0x223344, near: 2, far: 12 },
      });
      app.stage.addChild(view3d);
      view3d.camera.position.set(0, 0, 4);
      view3d.root.addChild(new Sprite3D({ texture: makeTexture(), billboardMode: 'spherical' }));
      app.render();

      const key = billboardKeys(app)[0];
      expect(key).toBeDefined();
      expect(key).toContain('linearFog');
      expect(key.indexOf('meshBillboard')).toBeLessThan(key.indexOf('linearFog'));
    } finally {
      app.destroy();
    }
  });

  it('recompiles to the other variant when the mode flips at runtime, with no material change', async () => {
    const app = await getApp<WebGLRenderer | WebGPURenderer>({
      id: 'billboard-swap',
      appOptions: { width: 128, height: 128 },
    });
    try {
      const view3d = new View3D({ width: 128, height: 128 });
      app.stage.addChild(view3d);
      view3d.camera.position.set(0, 0, 4);

      const sprite = new Sprite3D({ texture: makeTexture(), billboardMode: 'spherical' });
      view3d.root.addChild(sprite);
      app.render();

      expect(billboardKeys(app).some((k) => k.includes('meshBillboardSpherical'))).toBe(true);
      expect(billboardKeys(app).some((k) => k.includes('meshBillboardCylindrical'))).toBe(false);

      sprite.billboardMode = 'cylindrical';
      app.render();

      expect(billboardKeys(app).some((k) => k.includes('meshBillboardCylindrical'))).toBe(true);
    } finally {
      app.destroy();
    }
  });
});
