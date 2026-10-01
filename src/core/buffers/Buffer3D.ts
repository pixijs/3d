import { Buffer } from 'pixi.js';
import type { BufferOptions } from 'pixi.js';

/**
 * A pixi `Buffer` that the renderer's garbage collector never frees
 *
 * Engine-owned buffers are held by recorded render bundles, bind groups and VAOs that replay
 * without fetching their resources again, so the GC must not free one from under them. A pixi
 * `Buffer` is collectable by default and its options can't turn that off, so this class does. A
 * `Buffer3D`'s GPU memory comes back only through its owner's `unload` or `destroy`.
 * @internal
 */
export class Buffer3D extends Buffer {
  constructor(options: BufferOptions) {
    super(options);
    this.autoGarbageCollect = false;
  }
}
