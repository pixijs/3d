import { BufferUsage } from 'pixi.js';

import { Buffer3D } from './Buffer3D';
import { ARGS_PER_COMMAND, DrawArgs } from './DrawArgs';

/** @internal */
export class IndirectDrawData extends DrawArgs {
  public drawCallsBuffer: Buffer3D;

  constructor(label = 'DrawCalls', initialCommands = 128) {
    super(initialCommands);

    this.drawCallsBuffer = new Buffer3D({
      data: this.drawCalls,
      usage: BufferUsage.INDIRECT | BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
      label,
      shrinkToFit: false,
    });
  }

  /** Growth gives pixi a new `GPUBuffer`, and `CullResult.sync` drops the bundle that baked the old one */
  public override ensureCapacity(commandCount: number): Uint32Array {
    const before = this.drawCalls;
    const after = super.ensureCapacity(commandCount);
    if (after !== before) this.drawCallsBuffer.data = after;
    return after;
  }

  public upload(commandCount: number): void {
    this.drawCallsBuffer.update(commandCount * ARGS_PER_COMMAND * 4);
  }

  /** Copies all five lanes, not just the counts, since the indirect draw reads its offsets from here too */
  public copyCommandsFrom(source: DrawArgs, commandCount: number): void {
    const dst = this.ensureCapacity(commandCount);
    dst.set(source.drawCalls.subarray(0, commandCount * ARGS_PER_COMMAND));
    this.upload(commandCount);
  }

  public unload(): void {
    this.drawCallsBuffer?.unload();
  }

  public override destroy(): void {
    if (!this.drawCallsBuffer) return;

    this.drawCallsBuffer.destroy();
    (this.drawCallsBuffer as Buffer3D | null) = null;

    super.destroy();
  }
}
