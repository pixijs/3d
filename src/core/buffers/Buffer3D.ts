import { Buffer } from 'pixi.js';
import type { BufferOptions } from 'pixi.js';

/**
 * A pixi `Buffer` the GC never frees, since recorded bundles, bind groups and VAOs replay it without
 * a lookup; only its owner's `unload` or `destroy` frees it
 * @internal
 */
export class Buffer3D extends Buffer {
  constructor(options: BufferOptions) {
    super(options);
    this.autoGarbageCollect = false;
  }
}
