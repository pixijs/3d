import type { Texture } from 'pixi.js';

import type { BaseMaterial3D } from '../BaseMaterial3D';

/**
 * A material's `textures`: one property per texture slot its shader declares
 *
 * Reading a slot gives the bound texture, and assigning one swaps it. Assigning a name with no slot
 * throws. Every slot holds a texture; one you never set holds the material's default, usually
 * `Texture.WHITE`. Swaps don't change the shader, except a normal slot moving between its flat
 * default and a real normal map, which adds or drops normal mapping.
 *
 * Each material narrows this type with its own slots, as {@link Material3DTextures} does. The
 * index type includes `undefined` only so those can list optional slots: assigning `undefined`
 * type-checks, but it throws and leaves the slot empty.
 * @example
 * ```ts
 * const water = new BaseMaterial3D({
 *   descriptor: { bitsGpu: [myRippleBit], bitsGl: [myRippleBit] },
 *   textures: { ripples: rippleTexture },
 * });
 * water.textures.ripples = calmRippleTexture;
 * ```
 * @category materials
 * @standard
 */
export interface MaterialTextures {
  [slot: string]: Texture | undefined;
}

type MaterialTexturesClass = new (material: BaseMaterial3D) => object;

const classCache = new Map<string, MaterialTexturesClass>();

/**
 * Build, or return the cached, textures class for an ordered list of slot names
 *
 * One class per list. The derivation walk that produced the list also fixed each name's index, so
 * each accessor bakes its index in. Writes go through `BaseMaterial3D._setTextureSlot`, which owns
 * what a swap does. That covers normal mapping too: a swap to another texture source makes each
 * mesh using the material pick its shader again, and that checks the normal slot.
 * Instances are sealed, so a misspelt slot name throws instead of adding a property the renderer
 * never reads.
 * @param names - Slot names in pack order, as the material's derivation walk fixed them
 * @internal
 */
export function getOrCreateMaterialTexturesClass(names: readonly string[]): MaterialTexturesClass {
  const key = names.join('\n');
  let TexturesClass = classCache.get(key);
  if (TexturesClass) return TexturesClass;

  class MaterialTextures {
    public readonly _material: BaseMaterial3D;

    constructor(material: BaseMaterial3D) {
      this._material = material;
      Object.seal(this);
    }
  }

  names.forEach((name, index) => {
    Object.defineProperty(MaterialTextures.prototype, name, {
      get(this: MaterialTextures): Texture {
        return this._material._textures[index];
      },
      set(this: MaterialTextures, value: Texture) {
        this._material._setTextureSlot(index, value);
      },
      enumerable: true,
      configurable: false,
    });
  });

  TexturesClass = MaterialTextures as MaterialTexturesClass;
  classCache.set(key, TexturesClass);
  return TexturesClass;
}
