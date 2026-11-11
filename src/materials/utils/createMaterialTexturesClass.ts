import type { Texture } from 'pixi.js';

import type { BaseMaterial3D } from '../BaseMaterial3D';

/**
 * A material's `textures`: one property per texture slot its shader declares; see
 * {@link BaseMaterial3D#textures}
 *
 * A slot you never set holds the material's default, usually `Texture.WHITE`. Each material narrows
 * this type with its own slots, as {@link Material3DTextures} does. The index type includes
 * `undefined` only so those can list optional slots: assigning `undefined` type-checks, but it
 * throws and leaves the slot empty.
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
 * One class per slot list, each accessor with its slot index baked in; instances are sealed, so a
 * misspelt slot name throws
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

  TexturesClass = MaterialTextures;
  classCache.set(key, TexturesClass);
  return TexturesClass;
}
