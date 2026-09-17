import { Buffer } from 'pixi.js';
import type { BufferOptions } from 'pixi.js';

/**
 * A pixi `Buffer` that is exempt from the renderer's garbage collector
 *
 * Engine-owned buffers are baked into recorded render bundles, bind groups, and
 * VAOs that replay without re-fetching resources, so the GC must never free
 * them out from under a recorded artifact. Pixi's `Buffer` is collectable by
 * default with no constructor option, so the exemption lives here instead.
 * GPU memory held by a `Buffer3D` is returned only through its owner's
 * destroy/unload paths.
 * @internal
 */
export class Buffer3D extends Buffer {
  constructor(options: BufferOptions) {
    super(options);
    this.autoGarbageCollect = false;
  }
}
