import { BufferResource } from 'pixi.js';

/**
 * Drops the buffer listener every material would add, which each destroy would walk the whole list
 * to remove; `MaterialDataStoreBuffer.uniformResource` replaces the resource when the buffer goes
 * @internal
 */
export class MaterialRowResource extends BufferResource {
  constructor(options: ConstructorParameters<typeof BufferResource>[0]) {
    super(options);
    // oxlint-disable-next-line typescript/unbound-method -- the emitter matches a listener by function and context, and this passes both
    this.buffer.off('change', this.onBufferChange, this);
  }
}
