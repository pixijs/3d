import type { Buffer, WebGPURenderer } from 'pixi.js';

/**
 * Stands in for pixi's coming `renderer.buffer.write`. Leaves `buffer.data` alone; offset and length are multiples of 4
 * @internal
 */
// unused-internal-disable-next-line -- the atlas's no-CPU-copy change uses it next
export function writeBufferGpu(renderer: WebGPURenderer, buffer: Buffer, data: ArrayBufferView, offset = 0): void {
  renderer.gpu.device.queue.writeBuffer(
    renderer.buffer.getGPUBuffer(buffer),
    offset,
    data.buffer,
    data.byteOffset,
    data.byteLength,
  );
}

/**
 * Stands in for pixi's coming `renderer.buffer.copy`. Submits its own encoder now, since a copy can't run inside the
 * frame's render pass; every value is a multiple of 4
 * @internal
 */
// unused-internal-disable-next-line -- the atlas's no-CPU-copy change uses it next
export function copyBufferGpu(
  renderer: WebGPURenderer,
  from: Buffer,
  to: Buffer,
  size: number,
  fromOffset = 0,
  toOffset = 0,
): void {
  const device = renderer.gpu.device;
  const encoder = device.createCommandEncoder({ label: 'copyBufferGpu' });

  encoder.copyBufferToBuffer(
    renderer.buffer.getGPUBuffer(from),
    fromOffset,
    renderer.buffer.getGPUBuffer(to),
    toOffset,
    size,
  );
  device.queue.submit([encoder.finish()]);
}
