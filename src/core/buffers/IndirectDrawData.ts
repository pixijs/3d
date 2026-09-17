import { BufferUsage } from 'pixi.js';

import { Buffer3D } from './Buffer3D';
import { ARGS_PER_COMMAND, DrawArgs } from './DrawArgs';

/**
 * {@link DrawArgs} with the GPU buffer indirect draws read them from
 *
 * A `DrawCommandList` replays against one of these; each `CullResult` owns one, its static lanes
 * copied from the draw list's `DrawArgs` on sync and its `instanceCount` lanes rewritten each
 * frame by the cull — the CPU walk or the compute kernel.
 * @internal
 */
export class IndirectDrawData extends DrawArgs {
  /**
   * GPU-side view of `drawCalls`
   *
   * `INDIRECT` so `drawIndexedIndirect` sources it, `STORAGE` so the cull compute writes the counts,
   * `COPY_SRC` so the debug overlay can read survivor counts back (a transfer usage on an already
   * device-local buffer — no runtime cost to the draw path).
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
   * Ensures room for `commandCount` commands, re-pointing the GPU buffer at the array on growth
   *
   * Reassigning `.data` re-creates the GPUBuffer at the new size; growth only happens on a
   * structural rebuild, which re-records the bundle that reads it, so there's no stale baked reference.
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
   * Uploads `commandCount` commands to the GPU
   *
   * Call after the cull, before replay.
   * @param commandCount - Number of commands to upload.
   */
  public upload(commandCount: number): void {
    this.drawCallsBuffer.update(commandCount * ARGS_PER_COMMAND * 4); // 5 u32 * 4 bytes per command
  }

  /**
   * Copies `commandCount` whole command records from `source` and uploads
   *
   * Each record is all 5 lanes, not just the count: the indirect draw sources index count + offsets
   * from *this* buffer, so a cull result's own args buffer must carry the static lanes too. Done on
   * rebuild (`CullResult.sync`); after that the per-frame cull only rewrites the `instanceCount` lane
   * in place (the compute on GPU, or the CPU walk).
   * @param source - The args to copy records from.
   * @param commandCount - Number of commands to copy.
   */
  public copyCommandsFrom(source: DrawArgs, commandCount: number): void {
    const dst = this.ensureCapacity(commandCount);
    dst.set(source.drawCalls.subarray(0, commandCount * ARGS_PER_COMMAND));
    this.upload(commandCount);
  }

  /**
   * Frees the GPU copy of the draw args while keeping the CPU array
   *
   * pixi re-creates the buffer from `drawCalls` on the next fetch, and the next
   * rebuild rewrites the args anyway. Idempotent.
   */
  public unload(): void {
    this.drawCallsBuffer?.unload();
  }

  /** Releases the exclusively-owned GPU buffer and drops the backing array; idempotent */
  public override destroy(): void {
    if (!this.drawCallsBuffer) return;

    this.drawCallsBuffer.destroy();
    (this.drawCallsBuffer as Buffer3D | null) = null;

    super.destroy();
  }
}
