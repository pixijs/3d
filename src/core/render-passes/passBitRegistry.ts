import { warn } from 'pixi.js';

/** @internal */
class PassBitRegistry {
  /**
   * Built-in pass names at their `RenderPassBit` values in `RenderPass.ts` (`blendedRefraction` is
   * missing), written out because importing them is a cycle; change the two together
   */
  private _bitsByName: Record<string, number> = Object.assign(Object.create(null), {
    shadow: 1 << 0,
    opaque: 1 << 1,
    transparent: 1 << 2,
    background: 1 << 3,
    transmission: 1 << 4,
  });

  /** Custom bits start here, one per new name; bitwise ops are 32-bit, so about 23 fit */
  private _nextBit = 1 << 8;

  public getOrAllocate(name: string, explicitBit?: number): number {
    const existing = this._bitsByName[name];
    if (existing !== undefined) {
      if (explicitBit !== undefined && explicitBit !== existing) {
        warn(
          `[@pixi/3d] pass "${name}" already registered with bit ${existing}; ignoring explicit bit ${explicitBit}.`,
        );
      }
      return existing;
    }
    const bit = explicitBit ?? this._nextBit;
    if (explicitBit === undefined) this._nextBit <<= 1;
    this._bitsByName[name] = bit;
    return bit;
  }

  /** Never allocates, so disabling a name nothing has used spends no bit */
  public get(name: string): number | undefined {
    return this._bitsByName[name];
  }

  public nameOf(bit: number): string | undefined {
    return Object.keys(this._bitsByName).find((name) => this._bitsByName[name] === bit);
  }
}

/**
 * One for the page, not per renderer, so a material's pass names map to the same bits in every view
 * @internal
 */
export const passBitRegistry = new PassBitRegistry();
