import { getApp } from '@test-utils';
import { BufferUsage } from 'pixi.js';
import type { Buffer, Renderer, WebGLRenderer, WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { Buffer3D } from '~/core/buffers/Buffer3D';
import { copyBufferGl, writeBufferGl } from '~/core/gl/bufferWritesGl';
import { copyBufferGpu, writeBufferGpu } from '~/core/gpu/bufferWritesGpu';

const BYTES = 16;

function sizeOnlyBuffer(): Buffer3D {
  return new Buffer3D({ size: 32, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST | BufferUsage.COPY_SRC });
}

async function readBackGpu(renderer: WebGPURenderer, buffer: Buffer): Promise<Uint32Array> {
  const device = renderer.gpu.device;
  const staging = device.createBuffer({ size: BYTES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(renderer.buffer.getGPUBuffer(buffer), 0, staging, 0, BYTES);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const words = new Uint32Array(staging.getMappedRange().slice(0));
  staging.destroy();
  return words;
}

function readBackGl(renderer: WebGLRenderer, buffer: Buffer): Uint32Array {
  const gl = renderer.gl;
  const words = new Uint32Array(BYTES / 4);
  gl.bindBuffer(gl.COPY_READ_BUFFER, renderer.buffer.getGlBuffer(buffer).buffer);
  gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, words);
  return words;
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`buffer writes (${preference})`, () => {
    it('writes into a size-only buffer and copies a range of it into another, on the GPU', async () => {
      const app = await getApp<Renderer>({
        id: `buffer-writes-${preference}`,
        appOptions: { preference, width: 16, height: 16, autoStart: false },
      });
      const from = sizeOnlyBuffer();
      const to = sizeOnlyBuffer();

      try {
        const words = new Uint32Array([0xdead, 1, 2, 3, 4]).subarray(1);

        let read: Uint32Array;
        if (preference === 'webgpu') {
          const renderer = app.renderer as WebGPURenderer;
          writeBufferGpu(renderer, from, words, 8);
          copyBufferGpu(renderer, from, to, 8, 12, 4);
          read = await readBackGpu(renderer, to);
        } else {
          const renderer = app.renderer as WebGLRenderer;
          writeBufferGl(renderer, from, words, 8);
          copyBufferGl(renderer, from, to, 8, 12, 4);
          read = readBackGl(renderer, to);
        }

        expect(from.data, 'the CPU side stays empty').toBeFalsy();
        expect([...read], 'words 2 and 3 of the write, copied to byte 4').toEqual([0, 2, 3, 0]);
      } finally {
        from.destroy();
        to.destroy();
        app.destroy(true, { children: true });
      }
    });
  });
}
