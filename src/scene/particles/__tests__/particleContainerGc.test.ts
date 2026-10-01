import { expectCleanRender, getApp } from '@test-utils';
import type { Application, Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { ParticleContainer3D } from '~/scene/particles/ParticleContainer3D';
import { ensureQuadBuffers, MAX_U16_CAPACITY } from '~/scene/particles/utils/particleGeometry';
import { View3D } from '~/scene/View3D';

const SIZE = 128;

/** pixi keeps one GPU copy per renderer of a buffer, keyed by renderer uid. */
function gpuCopies(resource: { _gpuData: Record<number, unknown> }): number {
  let n = 0;
  for (const uid in resource._gpuData) {
    if (resource._gpuData[uid]) n++;
  }
  return n;
}

/** A sparse grid of the rendered frame, enough to tell a correct frame from a broken one. */
function readPixels(app: Application<Renderer>, view3d: View3D): number[] {
  const { pixels, width, height } = app.renderer.extract.pixels(view3d);
  const samples: number[] = [];
  for (let y = 4; y < height; y += 8) {
    for (let x = 4; x < width; x += 8) {
      const i = (y * width + x) * 4;
      samples.push(pixels[i], pixels[i + 1], pixels[i + 2]);
    }
  }
  return samples;
}

/**
 * A column of four white quads at `x`. Mask mode puts them in the opaque pass, the one that
 * records bundles on WebGPU; a capacity past the 16-bit ceiling puts the container on the
 * 32-bit shared pair, whose growth is unbounded.
 */
function column(view3d: View3D, x: number, capacity = MAX_U16_CAPACITY + 1): ParticleContainer3D {
  const particles = new ParticleContainer3D({ capacity, alphaMode: 'mask' });
  for (let i = 0; i < 4; i++) particles.setParticleAt(i, x, 1.8 - i * 1.2, 0, 1);
  particles.upload();
  view3d.root.addChild(particles);
  return particles;
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`ParticleContainer3D gc (${preference})`, () => {
    async function withView(id: string, run: (app: Application<Renderer>, view3d: View3D) => Promise<void>) {
      const app = await getApp<Renderer>({
        id: `${id}-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x000000 },
      });
      try {
        const view3d = new View3D({ width: SIZE, height: SIZE });
        app.stage.addChild(view3d);
        view3d.camera.position.set(0, 0, 8);
        view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
        await run(app, view3d);
      } finally {
        app.destroy();
      }
    }

    it('destroy(true) frees the records buffer and material and leaves the shared pair to the others', async () => {
      await withView('particle-destroy', async (app, view3d) => {
        const a = column(view3d, -1.5);
        const b = column(view3d, 1.5);
        app.render();
        const both = readPixels(app, view3d);
        expect(both.some((channel) => channel > 0)).toBe(true);

        const records = a.geometry.attributes.aPosition.buffer;
        const corners = b.geometry.attributes.aUV.buffer;
        const indices = b.geometry.indexBuffer;
        const material = a.material;
        expect(a.geometry.attributes.aUV.buffer).toBe(corners);
        expect(a.geometry.indexBuffer).toBe(indices);

        a.destroy(true);
        expect(records.destroyed).toBe(true);
        expect(material.destroyed).toBe(true);
        expect(corners.destroyed).toBe(false);
        expect(indices.destroyed).toBe(false);

        await expectCleanRender(app);
        const remaining = readPixels(app, view3d);
        expect(remaining.some((channel) => channel > 0)).toBe(true);
        expect(remaining).not.toEqual(both);

        b.destroy();
      });
    });

    it('the last container to go destroys the shared pair and the next one rebuilds it', async () => {
      await withView('particle-release', async (app, view3d) => {
        const a = column(view3d, -1.5);
        const b = column(view3d, 1.5);
        const corners = a.geometry.attributes.aUV.buffer;
        const indices = a.geometry.indexBuffer;
        expect(b.geometry.attributes.aUV.buffer).toBe(corners);
        expect(b.geometry.indexBuffer).toBe(indices);
        app.render();

        a.destroy();
        expect(corners.destroyed).toBe(false);
        expect(indices.destroyed).toBe(false);

        b.destroy();
        expect(corners.destroyed).toBe(true);
        expect(indices.destroyed).toBe(true);

        const c = column(view3d, 0);
        expect(c.geometry.attributes.aUV.buffer).not.toBe(corners);
        expect(c.geometry.indexBuffer).not.toBe(indices);
        expect(c.geometry.attributes.aUV.buffer.destroyed).toBe(false);
        expect(c.geometry.indexBuffer.destroyed).toBe(false);

        await expectCleanRender(app);
        expect(readPixels(app, view3d).some((channel) => channel > 0)).toBe(true);

        c.destroy();
      });
    });

    it('unload gives every GPU copy back and the next render restores them', async () => {
      await withView('particle-unload', async (app, view3d) => {
        const particles = column(view3d, 0);
        app.render();
        const before = readPixels(app, view3d);
        expect(before.some((channel) => channel > 0)).toBe(true);

        const records = particles.geometry.attributes.aPosition.buffer;
        const corners = particles.geometry.attributes.aUV.buffer;
        const indices = particles.geometry.indexBuffer;
        expect(gpuCopies(records)).toBe(1);
        expect(gpuCopies(corners)).toBe(1);
        expect(gpuCopies(indices)).toBe(1);

        particles.unload();
        expect(gpuCopies(records)).toBe(0);
        expect(gpuCopies(corners)).toBe(0);
        expect(gpuCopies(indices)).toBe(0);

        await expectCleanRender(app);
        expect(gpuCopies(records)).toBe(1);
        expect(gpuCopies(corners)).toBe(1);
        expect(gpuCopies(indices)).toBe(1);
        expect(readPixels(app, view3d)).toEqual(before);

        particles.destroy();
      });
    });

    it('growing the shared pair under recorded draws, with no new container, keeps every container drawing', async () => {
      await withView('particle-grow', async (app, view3d) => {
        const a = column(view3d, -1.5);
        const b = column(view3d, 1.5);
        app.render();
        app.render();
        const before = readPixels(app, view3d);
        expect(before.some((channel) => channel > 0)).toBe(true);

        const pair = ensureQuadBuffers(MAX_U16_CAPACITY + 1);
        expect(a.geometry.indexBuffer).toBe(pair.indices);
        ensureQuadBuffers(pair.capacity + 1);
        expect(a.geometry.indexBuffer).toBe(pair.indices);
        expect(b.geometry.attributes.aUV.buffer).toBe(pair.corners);

        await expectCleanRender(app);
        expect(readPixels(app, view3d)).toEqual(before);
        await expectCleanRender(app);
        expect(readPixels(app, view3d)).toEqual(before);

        a.destroy();
        b.destroy();
      });
    });
  });
}
