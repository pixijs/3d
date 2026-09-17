import { warn } from 'pixi.js';

/**
 * Global name → bit registry for render passes
 *
 * Pass bits are allocated once globally rather than per-pipe so that a
 * material can reference passes by name (`passes: { outline: true }`)
 * without needing to know about any specific pipe. Whatever code path
 * touches a name first — pass instantiation, material construction, or
 * `enablePass()` — allocates the bit; later references look up the same
 * bit. Materials and passes "rendezvous" on the global map regardless of
 * construction order, and the same material instance can be used across
 * multiple `View3D` instances because every pipe sees the same name → bit
 * mapping.
 *
 * Bits 0-7 are reserved for built-in passes. Custom passes start at
 * `1 << 8` and shift left for each new name. JS bitwise ops are 32-bit
 * signed, so ~23 custom-pass slots are usable in practice — plenty for
 * typical rendering setups but worth being aware of if a project
 * programmatically generates many distinct pass names.
 * @internal
 */
class PassBitRegistry {
  // Built-in pass bits are inlined here rather than imported from
  // `RenderPass.ts` to break a module-load cycle (RenderPass imports
  // this registry). Values must match `RenderPassBit` in RenderPass.ts.
  // Passes that take no meshes (the graph operations, the fullscreen effects) register
  // themselves at `RenderPassBit.NONE` rather than burning one of the custom slots.
  private _bitsByName: Record<string, number> = Object.assign(Object.create(null), {
    shadow: 1 << 0,
    opaque: 1 << 1,
    transparent: 1 << 2,
    background: 1 << 3,
    transmission: 1 << 4,
  });

  private _nextBit = 1 << 8;

  /**
   * Looks up the bit allocated to a pass name, allocating a fresh one if the name has
   * never been seen
   * @param name - The pass's `name` (the same string used in `RenderPass`'s
   *   `name` option and in materials' `passes: { ... }` keys).
   * @param explicitBit - Optional fixed bit (used by built-in passes that
   *   reserve a stable bit constant). When provided on first registration,
   *   pins the bit. When provided on a subsequent registration with a
   *   different value, a warning is emitted and the original bit is kept.
   * @returns The bit allocated for `name`.
   */
  public getOrAllocate(name: string, explicitBit?: number): number {
    const existing = this._bitsByName[name];
    if (existing !== undefined) {
      if (explicitBit !== undefined && explicitBit !== existing) {
        warn(`[pixi-3d] pass "${name}" already registered with bit ${existing}; ignoring explicit bit ${explicitBit}.`);
      }
      return existing;
    }
    const bit = explicitBit ?? this._nextBit;
    if (explicitBit === undefined) this._nextBit <<= 1;
    this._bitsByName[name] = bit;
    return bit;
  }

  /**
   * Returns the bit registered for `name` without allocating one if absent
   *
   * Used by `disablePass` so disabling a never-registered name is a no-op rather than
   * wasting a bit on an entry that will never have a pass instance behind it.
   * @param name - The pass name to look up
   * @returns The registered bit, or `undefined` when the name has never been seen
   */
  public get(name: string): number | undefined {
    return this._bitsByName[name];
  }
}

/**
 * Global pass-bit registry singleton
 * @internal
 */
export const passBitRegistry = new PassBitRegistry();
