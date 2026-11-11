/**
 * `u32`s per command, in `drawIndexedIndirect` order
 * @internal
 */
export const ARGS_PER_COMMAND = 5;

/** @internal */
export class DrawArgs {
  /** {@link ensureCapacity} may replace the array, so read it rather than holding it */
  public drawCalls: Uint32Array;

  constructor(initialCommands = 128) {
    this.drawCalls = new Uint32Array(initialCommands * ARGS_PER_COMMAND);
  }

  /** Growth keeps the contents, since the batcher grows the array mid-build */
  public ensureCapacity(commandCount: number): Uint32Array {
    const needed = commandCount * ARGS_PER_COMMAND;
    if (this.drawCalls.length < needed) {
      const grown = new Uint32Array(Math.ceil(commandCount * 1.5) * ARGS_PER_COMMAND);
      grown.set(this.drawCalls);
      this.drawCalls = grown;
    }
    return this.drawCalls;
  }

  public destroy(): void {
    (this.drawCalls as Uint32Array | null) = null;
  }
}
