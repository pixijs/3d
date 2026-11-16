import type { Buffer, WebGLRenderer } from 'pixi.js';

/**
 * Stands in for pixi's coming `renderer.buffer.write`. `updateBuffer` gives a size-only buffer its storage, which
 * `getGlBuffer` doesn't; `COPY_WRITE_BUFFER` is read by no vertex array, so an index buffer write leaves them alone
 * @internal
 */
// unused-internal-disable-next-line -- the atlas's no-CPU-copy change uses it next
export function writeBufferGl(renderer: WebGLRenderer, buffer: Buffer, data: ArrayBufferView, offset = 0): void {
  const gl = renderer.gl;

  gl.bindBuffer(gl.COPY_WRITE_BUFFER, renderer.buffer.updateBuffer(buffer).buffer);
  gl.bufferSubData(gl.COPY_WRITE_BUFFER, offset, data);
}

/**
 * Stands in for pixi's coming `renderer.buffer.copy`, through the copy targets for the reason `writeBufferGl` gives
 * @internal
 */
// unused-internal-disable-next-line -- the atlas's no-CPU-copy change uses it next
export function copyBufferGl(
  renderer: WebGLRenderer,
  from: Buffer,
  to: Buffer,
  size: number,
  fromOffset = 0,
  toOffset = 0,
): void {
  const gl = renderer.gl;

  gl.bindBuffer(gl.COPY_READ_BUFFER, renderer.buffer.updateBuffer(from).buffer);
  gl.bindBuffer(gl.COPY_WRITE_BUFFER, renderer.buffer.updateBuffer(to).buffer);
  gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, fromOffset, toOffset, size);
}
