import { getApp } from '@test-utils';
import { CanvasSource, Texture } from 'pixi.js';
import type { Application, Renderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { Animation } from '~/animation/Animation';
import { Scene3DSource } from '~/assets/Scene3DSource';
import { NORMAL_MAP } from '~/core/textures/DefaultTextures';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Model3D } from '~/scene/Model3D';
import { View3D } from '~/scene/View3D';

const SIZE = 64;

describe('Scene3DSource.destroy', () => {
  it('spares the shared default textures every material falls back to', () => {
    const { source, texture } = buildSource();
    source.textures.push(Texture.WHITE, Texture.EMPTY, NORMAL_MAP);
    const whiteDestroy = vi.spyOn(Texture.WHITE, 'destroy');
    const emptyDestroy = vi.spyOn(Texture.EMPTY, 'destroy');
    const normalDestroy = vi.spyOn(NORMAL_MAP, 'destroy');

    try {
      source.destroy();

      expect(texture.destroyed).toBe(true);
      expect(whiteDestroy).not.toHaveBeenCalled();
      expect(emptyDestroy).not.toHaveBeenCalled();
      expect(normalDestroy).not.toHaveBeenCalled();
      expect(NORMAL_MAP.destroyed).toBe(false);
      expect(NORMAL_MAP.source.destroyed).toBe(false);
    } finally {
      whiteDestroy.mockRestore();
      emptyDestroy.mockRestore();
      normalDestroy.mockRestore();
    }
  });
});

/** pixi keeps one GPU copy per renderer of a buffer or texture source, keyed by renderer uid. */
interface GpuResident {
  _gpuData: Record<string, unknown>;
}

function gpuCopyCount(...resources: unknown[]): number {
  let n = 0;
  for (const resource of resources as GpuResident[]) n += Object.keys(resource._gpuData).length;
  return n;
}

function makeTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ff8800';
  ctx.fillRect(0, 0, 4, 4);

  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

/** A one-mesh source filled the way the glTF loader fills it; the geometry is dynamic so it owns its GPU buffers */
function buildSource() {
  const source = new Scene3DSource({
    scenes: [{ name: 'Main', children: [0] }],
    nodes: [{ label: 'Box', children: [], geometry: 0, materials: [0] }],
  });

  const texture = makeTexture();
  const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1, dynamic: true });
  const material = new Material3D({ baseColorTexture: texture, metallic: 0, roughness: 0.5 });

  // Two glTF textures sharing one image resolve to the same Texture
  source.textures.push(texture, texture);
  source.texture.Orange = texture;
  source.geometries.push([geometry]);
  source.geometry.Box = geometry;
  source.materials.push(material);
  source.material.Paint = material;
  source.animations.Idle = new Animation({ label: 'Idle' });

  return { source, texture, geometry, material };
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`Scene3DSource.destroy (${preference})`, () => {
    async function withApp(id: string, run: (app: Application<Renderer>) => void): Promise<void> {
      const app = await getApp<Renderer>({
        id: `${id}-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });
      try {
        run(app);
      } finally {
        app.destroy();
      }
    }

    it('frees the GPU copies of its geometry and textures and releases its references', async () => {
      await withApp('scene3d-source-destroy', (app) => {
        const { source, texture, geometry, material } = buildSource();
        const view3d = new View3D({ width: SIZE, height: SIZE });
        app.stage.addChild(view3d);
        view3d.camera.position.set(0, 0, 4);

        const model = new Model3D(source);
        view3d.root.addChild(model);
        app.render();

        const textureSource = texture.source;
        const buffers = [...geometry.buffers];
        expect(gpuCopyCount(textureSource)).toBeGreaterThan(0);
        expect(gpuCopyCount(...buffers)).toBeGreaterThan(0);

        model.destroy();
        const textureDestroy = vi.spyOn(texture, 'destroy');
        source.destroy();

        expect(source.destroyed).toBe(true);
        expect(textureDestroy).toHaveBeenCalledTimes(1);
        expect(texture.destroyed).toBe(true);
        expect(textureSource.destroyed).toBe(true);
        expect(gpuCopyCount(textureSource)).toBe(0);
        expect(buffers.every((buffer) => buffer.destroyed)).toBe(true);
        expect(gpuCopyCount(...buffers)).toBe(0);
        expect(material.destroyed).toBe(true);

        expect(source.textures).toBeNull();
        expect(source.materials).toBeNull();
        expect(source.geometries).toBeNull();
        expect(source.texture).toBeNull();
        expect(source.material).toBeNull();
        expect(source.geometry).toBeNull();
        expect(source.animations).toBeNull();
        expect(source.scene).toBeNull();

        source.destroy();
        expect(textureDestroy).toHaveBeenCalledTimes(1);

        app.render();
      });
    });
  });
}
