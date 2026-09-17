/**
 * Draw args are 5 u32 per command, in `drawIndexedIndirect` order
 * @internal
 */
export const ARGS_PER_COMMAND = 5;

/**
 * The numeric draw args for a list of draw commands, as a CPU array
 *
 * Each command is 5 u32: `[indexCount, instanceCount, firstIndex, baseVertex, firstInstance]`.
 * The batcher writes every lane on rebuild, with each command's full instance count. A
 * {@link DrawList} owns one: WebGL draws straight from it, rewriting the `instanceCount` lanes
 * in place per draw; on WebGPU it is the template every cull result copies its lanes from, and the
 * result's copy is an {@link IndirectDrawData}, the GPU-backed form that indirect draws read.
 * @internal
 */
export class DrawArgs {
  /** Interleaved args, 5 u32 per command; reallocated by `ensureCapacity` */
  public drawCalls: Uint32Array;

  constructor(initialCommands = 128) {
    this.drawCalls = new Uint32Array(initialCommands * ARGS_PER_COMMAND);
  }

  /**
   * Ensures room for `commandCount` commands and returns the current (possibly reallocated) array
   *
   * Growth preserves the existing contents — the batcher writes commands one at a time, so a grow
   * mid-build must keep the earlier ones (unlike the instance buffer, whose caller rewrites every
   * slot).
   * @param commandCount - Number of commands to make room for.
   * @returns The current backing array.
   */
  public ensureCapacity(commandCount: number): Uint32Array {
    const needed = commandCount * ARGS_PER_COMMAND;
    if (this.drawCalls.length < needed) {
      const grown = new Uint32Array(Math.ceil(commandCount * 1.5) * ARGS_PER_COMMAND);
      grown.set(this.drawCalls);
      this.drawCalls = grown;
    }
    return this.drawCalls;
  }

  /** Drops the backing array. Idempotent — a second call is a no-op */
  public destroy(): void {
    (this.drawCalls as Uint32Array | null) = null;
  }
}
