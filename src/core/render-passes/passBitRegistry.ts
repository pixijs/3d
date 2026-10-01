import { warn } from 'pixi.js';

/**
 * Global name → bit registry for render passes
 *
 * One map for the whole page rather than one per pipe, so a material can name a pass
 * (`passes: { outline: true }`) without knowing any pipe, and one material works in several
 * views. Whatever uses a name first allocates its bit: the pass's constructor, a material's
 * `passes` option, or `enablePass()`. Later uses get the same bit, in any order.
 *
 * Bits 0-7 are reserved for built-in passes. Custom passes start at `1 << 8` and shift left for
 * each new name. JS bitwise ops are 32-bit signed, so about 23 custom names fit, which only a
 * project that generates pass names needs to worry about.
 * @internal
 */
class PassBitRegistry {
  /**
   * Bits by pass name, seeded with the built-in passes
   *
   * The seed repeats the values of `RenderPassBit` in `RenderPass.ts` by name, since importing them
   * would make a module cycle (`RenderPass.ts` imports this registry); change the two together.
   * Passes that take no meshes register at `RenderPassBit.NONE` and use up no custom bit.
   */
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
   * @param name - The pass's `name`, as a material's `passes` option keys it
   * @param explicitBit - Fixed bit a built-in pass asks for. It pins the bit for a new name; for a
   *   name that already has a different bit, it warns and keeps the old one.
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
   * `disablePass` uses it, so disabling a name nothing has used costs no bit.
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
