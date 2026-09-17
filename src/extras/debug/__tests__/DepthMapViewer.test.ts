import { getApp } from '@test-utils';
import { Texture, TextureSource } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { DepthMapViewer } from '../DepthMapViewer';

/** A four-layer depth array texture, the shape a cascaded shadow map has */
function depthArrayTexture(): Texture {
  return new Texture({
    source: new TextureSource({
      width: 4,
      height: 4,
      format: 'depth32float',
      scaleMode: 'nearest',
      viewDimension: '2d-array',
      autoGenerateMipmaps: false,
      arrayLayerCount: 4,
    }),
  });
}

/** How many renderers hold a GPU copy of this buffer or geometry */
function gpuCopies(resource: { _gpuData: Record<number, unknown> }): number {
  return Object.values(resource._gpuData).filter(Boolean).length;
}

/** Largest x of the viewer's quad */
function quadWidth(viewer: DepthMapViewer): number {
  return Math.max(...viewer.geometry.getAttribute('aPosition').buffer.data);
}

describe('DepthMapViewer', () => {
  it('sizes its quad from the options and forwards the mesh options', () => {
    const viewer = new DepthMapViewer({ texture: Texture.WHITE, size: 128, label: 'shadow map', x: 12 });

    expect(quadWidth(viewer)).toBe(128);
    expect(viewer.label).toBe('shadow map');
    expect(viewer.x).toBe(12);

    viewer.destroy();
  });

  it('reads its default size from defaultOptions', () => {
    const defaults = { ...DepthMapViewer.defaultOptions };
    const viewer = new DepthMapViewer({ texture: Texture.WHITE });

    expect(quadWidth(viewer)).toBe(256);
    viewer.destroy();

    try {
      DepthMapViewer.defaultOptions.size = 64;
      const small = new DepthMapViewer({ texture: Texture.WHITE, size: undefined });

      expect(quadWidth(small)).toBe(64);
      small.destroy();
    } finally {
      DepthMapViewer.defaultOptions = defaults;
    }
  });

  it('destroys the viewed texture when asked, but not its source', () => {
    const texture = depthArrayTexture();
    const viewer = new DepthMapViewer({ texture });

    viewer.destroy({ texture: true });

    expect(texture.destroyed).toBe(true);
    expect(texture.source.destroyed).toBe(false);
    expect(Texture.WHITE.destroyed).toBe(false);

    texture.source.destroy();
  });

  for (const preference of ['webgpu', 'webgl'] as const) {
    it(`frees its GPU copies on unload and rebuilds them on the next render (${preference})`, async () => {
      const app = await getApp<Renderer>({ id: `depth-map-viewer-unload-${preference}`, appOptions: { preference } });
      const texture = depthArrayTexture();

      try {
        const viewer = new DepthMapViewer({ texture, size: 64 });
        app.stage.addChild(viewer);
        app.render();

        const { geometry } = viewer;
        const buffers = [...geometry.buffers];

        expect(buffers.every((buffer) => gpuCopies(buffer) > 0)).toBe(true);
        // Only WebGL keeps a per-geometry GPU object (its VAO cache); WebGPU binds the buffers directly
        expect(gpuCopies(geometry)).toBe(preference === 'webgl' ? 1 : 0);

        viewer.unload();

        expect(buffers.every((buffer) => gpuCopies(buffer) === 0)).toBe(true);
        expect(gpuCopies(geometry)).toBe(0);
        expect(() => viewer.unload()).not.toThrow();

        app.render();

        expect(buffers.every((buffer) => gpuCopies(buffer) > 0)).toBe(true);
        expect(gpuCopies(geometry)).toBe(preference === 'webgl' ? 1 : 0);

        viewer.destroy();
        expect(() => viewer.unload()).not.toThrow();
      } finally {
        texture.destroy(true);
        app.destroy();
      }
    });

    it(`frees the geometry and shader it built on destroy (${preference})`, async () => {
      const app = await getApp<Renderer>({ id: `depth-map-viewer-${preference}`, appOptions: { preference } });
      const texture = depthArrayTexture();

      try {
        const viewer = new DepthMapViewer({ texture, size: 64 });
        app.stage.addChild(viewer);
        app.render();

        const { geometry, shader } = viewer;
        const buffers = [...geometry.buffers];
        let shaderDestroyed = false;
        shader!.on('destroy', () => (shaderDestroyed = true));

        expect(buffers.some((buffer) => gpuCopies(buffer) > 0)).toBe(true);

        viewer.destroy();

        expect(buffers.every((buffer) => buffer.destroyed && gpuCopies(buffer) === 0)).toBe(true);
        expect(geometry.buffers).toBeNull();
        expect(shaderDestroyed).toBe(true);
        expect(texture.destroyed).toBe(false);
        expect(Texture.WHITE.destroyed).toBe(false);

        expect(() => viewer.destroy()).not.toThrow();
        expect(() => app.render()).not.toThrow();
      } finally {
        texture.destroy(true);
        app.destroy();
      }
    });
  }
});
