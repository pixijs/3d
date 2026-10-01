import { getApp } from '@test-utils';
import { BufferImageSource, CubeTexture, Texture } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { fullscreenTriangleGeometry } from '~/core/fullscreenTriangleGeometry';
import { BackgroundPass } from '~/core/render-passes/background/BackgroundPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 64;

/** Enough cubes to grow the atlas past its first capacity, retiring the wrapper that holds a VAO */
const CUBES_PAST_ATLAS_CAPACITY = 200;

interface AtlasProbe {
  geometry: { uid: number } | null;
  _retiredGeometries: { uid: number }[];
  destroy(): void;
}

interface RendererProbe {
  geometry: { _managedGeometries: { items: Record<string, unknown> } };
  renderPipes: { view3d: { atlasPool: { _atlases: Record<string, AtlasProbe> } } };
}

interface PassProbe {
  _geometry: { uid: number };
}

/**
 * How many of `uids` still hold an entry in the GL geometry system's managed hash, its VAO cache
 *
 * Pixi frees an entry only from the geometry's `unload` event, which `destroy()` emits.
 */
function managedCount(renderer: RendererProbe, uids: number[]): number {
  const items = renderer.geometry._managedGeometries.items;
  return uids.filter((uid) => items[uid] != null).length;
}

function colorFace(r: number, g: number, b: number): Texture {
  return new Texture({
    source: new BufferImageSource({
      resource: new Uint8Array([r, g, b, 255]),
      format: 'rgba8unorm',
      width: 1,
      height: 1,
      alphaMode: 'premultiply-alpha-on-upload',
    }),
  });
}

function cubeMesh(material: Material3D): Mesh3D {
  return new Mesh3D({ geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }), material });
}

describe('pass- and atlas-owned geometries leave the WebGL geometry hash when destroyed (webgl)', () => {
  it('drops the background pass geometry and keeps the shared triangle when their View3D is destroyed', async () => {
    const app = await getApp<Renderer>({
      id: 'gl-geometry-release-passes',
      appOptions: { preference: 'webgl', width: SIZE, height: SIZE },
    });
    const renderer = app.renderer as unknown as RendererProbe;

    try {
      /** Composite, so its output pass draws the shared triangle */
      const view3d = new View3D({ width: SIZE, height: SIZE, composite: true });
      view3d.background = CubeTexture.from({
        faces: {
          right: colorFace(220, 60, 60),
          left: colorFace(60, 200, 200),
          top: colorFace(70, 200, 90),
          bottom: colorFace(200, 70, 200),
          front: colorFace(70, 110, 220),
          back: colorFace(220, 200, 70),
        },
      });
      view3d.root.addChild(cubeMesh(new Material3D({ baseColor: 0x888888, metallic: 0, roughness: 0.5 })));
      app.stage.addChild(view3d);
      app.render();
      app.render();

      const background = view3d._graph.passes.find((pass) => pass instanceof BackgroundPass) as unknown as PassProbe;
      const owned = [background._geometry.uid];
      /** The output pass's shared triangle, which outlives any one View */
      const shared = [fullscreenTriangleGeometry().uid];
      expect(managedCount(renderer, owned)).toBe(1);
      expect(managedCount(renderer, shared)).toBe(1);

      view3d.destroy({ children: true });
      expect(managedCount(renderer, owned)).toBe(0);
      expect(managedCount(renderer, shared)).toBe(1);
    } finally {
      app.destroy(true, { children: true });
    }
  });

  it('drops the live and every retired atlas wrapper when a GeometryAtlas is destroyed', async () => {
    const app = await getApp<Renderer>({
      id: 'gl-geometry-release-atlas',
      appOptions: { preference: 'webgl', width: SIZE, height: SIZE },
    });
    const renderer = app.renderer as unknown as RendererProbe;

    try {
      const view3d = new View3D({ width: SIZE, height: SIZE });
      const material = new Material3D({ baseColor: 0x888888, metallic: 0, roughness: 0.5 });
      app.stage.addChild(view3d);
      view3d.root.addChild(cubeMesh(material));
      app.render();
      app.render();

      for (let i = 0; i < CUBES_PAST_ATLAS_CAPACITY; i++) view3d.root.addChild(cubeMesh(material));
      app.render();
      app.render();

      const atlases = Object.values(renderer.renderPipes.view3d.atlasPool._atlases);
      const live = atlases.map((atlas) => atlas.geometry?.uid).filter((uid): uid is number => uid != null);
      const retired = atlases.flatMap((atlas) => atlas._retiredGeometries.map((wrapper) => wrapper.uid));
      expect(retired.length).toBeGreaterThan(0);
      expect(managedCount(renderer, live)).toBe(live.length);
      expect(managedCount(renderer, retired)).toBeGreaterThan(0);

      for (const atlas of atlases) atlas.destroy();
      expect(managedCount(renderer, live)).toBe(0);
      expect(managedCount(renderer, retired)).toBe(0);
    } finally {
      app.destroy(true, { children: true });
    }
  });
});
