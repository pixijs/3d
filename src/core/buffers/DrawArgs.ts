/**
 * `u32`s per command, in `drawIndexedIndirect` order
 * @internal
 */
export const ARGS_PER_COMMAND = 5;

/**
 * The numeric draw args of a list of draw commands, as a CPU array
 *
 * Each command is five `u32`s in the order `drawIndexedIndirect` reads them: index count, instance
 * count, first index, base vertex, first instance. The batcher writes every lane when it rebuilds,
 * with each command's full instance count.
 *
 * A {@link DrawList} owns one. WebGL draws straight from it, rewriting the instance counts in place
 * for each draw. On WebGPU, every cull result copies it into an {@link IndirectDrawData}, the form
 * indirect draws read from the GPU.
 * @internal
 */
export class DrawArgs {
  /** The args, five per command; `ensureCapacity` may replace the array */
  public drawCalls: Uint32Array;

  constructor(initialCommands = 128) {
    this.drawCalls = new Uint32Array(initialCommands * ARGS_PER_COMMAND);
  }

  /**
   * Makes room for `commandCount` commands and returns the array, which may be a new one
   *
   * Growth keeps the contents: the batcher writes commands one at a time, so growing mid-build must
   * keep the ones before.
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

  /** Drops the CPU array. Idempotent */
  public destroy(): void {
    (this.drawCalls as Uint32Array | null) = null;
  }
}
