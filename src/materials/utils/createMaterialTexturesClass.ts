import type { Texture } from 'pixi.js';

import type { BaseMaterial3D } from '../BaseMaterial3D';

/**
 * Keyed texture-slot surface of a material
 *
 * Generated per slot-name list; subclasses narrow it with their declared slots (see
 * `Material3DTextures`), mirroring how {@link MaterialData} is narrowed by typed data interfaces.
 *
 * The index value is `Texture | undefined` — not because a present slot ever
 * holds `undefined` (every slot is seeded with a default at derivation), but
 * because subclasses declare *optional* extension slots (e.g. `sheen?`), which
 * TypeScript only permits under an `undefined`-bearing index signature. The
 * consequence is that writing `undefined` to a slot type-checks yet crashes the
 * batcher's pack — treat slots as write-only-with-a-Texture.
 * @category materials
 * @standard
 */
export interface MaterialTextures {
  [slot: string]: Texture | undefined;
}

/**
 * Constructor for a generated, slot-list-specific material textures object
 * @internal
 */
type MaterialTexturesClass = new (material: BaseMaterial3D) => object;

const classCache = new Map<string, MaterialTexturesClass>();

/**
 * Build (or return the cached) textures class for an ordered slot-name list
 *
 * The generated class is the keyed runtime face of `_textures`, mirroring the construction
 * `textures:` option (`material.textures.waterNormal = tex`). One class per unique list; the
 * derivation walk that produced the list also fixed each name's index, so accessors bake their
 * slot index directly.
 *
 * Reads return the bound texture; writes delegate to `BaseMaterial3D._setTextureSlot`
 * (the shared slot-swap chokepoint — no-op when unchanged, otherwise re-batch
 * via the texture cache key, never a recompile) and then apply the
 * slot-name-specific shader-variant flip. Instances are sealed so a typo'd slot
 * write throws instead of silently creating an own property the batcher never sees.
 * @param names - Slot names in pack order, as fixed by the material's derivation walk
 * @returns The generated (or cached) textures class for the list
 * @internal
 */
export function getOrCreateMaterialTexturesClass(names: readonly string[]): MaterialTexturesClass {
  const key = names.join('\n');
  let TexturesClass = classCache.get(key);
  if (TexturesClass) return TexturesClass;

  class MaterialTextures {
    /** Owning material — accessors read/write its packed slot array */
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
        // All slot-write semantics live on the material: identity early-out, batch re-key, frame
        // derivation. The normal-mapping shader variant recompiles on its own via the texture-swap
        // dirty path (cross-source swap → _markDescriptorDirty → per-mesh _descriptorDirtyId
        // watermark → _batchDirty → ensureMaterial's live normal check), so no slot-name-specific
        // bookkeeping is needed here.
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
