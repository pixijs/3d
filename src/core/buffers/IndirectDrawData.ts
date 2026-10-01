import { BufferUsage } from 'pixi.js';

import { Buffer3D } from './Buffer3D';
import { ARGS_PER_COMMAND, DrawArgs } from './DrawArgs';

/**
 * {@link DrawArgs} with the GPU buffer that indirect draws read them from (WebGPU)
 *
 * A `DrawCommandList` replays against one. Each `CullResult` owns one: it copies every lane from
 * the draw list's `DrawArgs` when it syncs, and the cull, on the CPU or in the compute kernel,
 * rewrites the instance counts every frame.
 * @internal
 */
export class IndirectDrawData extends DrawArgs {
  /**
   * The GPU copy of `drawCalls`
   *
   * `INDIRECT` so indirect draws read it, and `STORAGE` so the cull compute writes the counts.
   * Nothing in the engine reads it back, which `COPY_SRC` would allow.
   */
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

  /**
   * Makes room for `commandCount` commands, pointing the GPU buffer at the new array when it grows
   *
   * Setting the buffer's `data` to a longer array makes pixi create a new `GPUBuffer`. Growth only
   * happens on a rebuild, which re-records the bundle that reads it, so no bundle keeps the old one.
   * @param commandCount - Number of commands to make room for.
   * @returns The current backing array.
   */
  public override ensureCapacity(commandCount: number): Uint32Array {
    const before = this.drawCalls;
    const after = super.ensureCapacity(commandCount);
    if (after !== before) this.drawCallsBuffer.data = after;
    return after;
  }

  /**
   * Uploads the first `commandCount` commands
   *
   * Call after the cull and before the replay.
   * @param commandCount - Number of commands to upload.
   */
  public upload(commandCount: number): void {
    this.drawCallsBuffer.update(commandCount * ARGS_PER_COMMAND * 4);
  }

  /**
   * Copies the first `commandCount` commands from `source`, all five lanes each, and uploads them
   *
   * All five, not just the counts, because the indirect draw reads the index count and offsets from
   * this buffer too. `CullResult.sync` calls it after a rebuild. From then on the cull rewrites only
   * the instance counts, in place.
   * @param source - The args to copy records from.
   * @param commandCount - Number of commands to copy.
   */
  public copyCommandsFrom(source: DrawArgs, commandCount: number): void {
    const dst = this.ensureCapacity(commandCount);
    dst.set(source.drawCalls.subarray(0, commandCount * ARGS_PER_COMMAND));
    this.upload(commandCount);
  }

  /**
   * Frees the GPU copy of the draw args and keeps the CPU array
   *
   * pixi re-creates the buffer from `drawCalls` the next time it's used, and the next rebuild
   * rewrites the args anyway. Idempotent.
   */
  public unload(): void {
    this.drawCallsBuffer?.unload();
  }

  /** Releases the GPU buffer and drops the CPU array. Idempotent */
  public override destroy(): void {
    if (!this.drawCallsBuffer) return;

    this.drawCallsBuffer.destroy();
    (this.drawCallsBuffer as Buffer3D | null) = null;

    super.destroy();
  }
}
