import { MATERIAL_STRIDE_FLOATS } from '../../core/buffers/MaterialDataStoreBuffer';
import { createStructLayout, formatStructLayout } from '../../core/shader/codegen/structLayout';
import type { StructDefinition } from '../../core/shader/ShaderBit';
import type { BaseMaterial3D } from '../BaseMaterial3D';

/**
 * A material's GPU-synced state
 *
 * One stride-sized buffer laid out exactly as the compiled Material struct, with a generated
 * accessor per field:
 *
 * - Scalars read/write as numbers (`u32` fields through the integer view).
 * - Vectors read as live `Float32Array` subarray views and write by copy
 *   from any array-like. Mutating a returned view writes the packed data
 *   directly but bypasses the upload queue — use the setter for normal writes.
 * - Every setter signals the owning material (`update()`), which queues
 *   the row on its store; the queue coalesces repeat writes.
 * - Fields the shader has but users shouldn't touch (`_pad`) get no accessor.
 *
 * Because the layout is the GPU layout, uploading a material is a single
 * `set()` of the packed `_f32` storage into the store buffer.
 * @category materials
 * @advanced
 */
export interface MaterialData {
  /**
   * Packed storage — exactly the Material struct layout, stride-sized
   * @internal
   */
  readonly _f32: Float32Array;
  // Base-material struct fields below are typed so BaseMaterial3D reads them without casts;
  // materials with a richer fixed struct narrow `data` further (see `Material3DData`).
  /** Linear-light base colour — present iff the compiled struct declares it */
  baseColor?: Float32Array;
  /** Alpha-mask cutoff threshold — present iff the compiled struct declares it */
  alphaCutoff?: number;
  /** Row-major 2x2 linear part of the UV transform, packed `[m00, m01, m10, m11]` — present iff the compiled struct declares it */
  uvTransformRow0?: Float32Array;
  /** Packed UV offset — present iff the compiled struct declares it */
  uvOffset?: Float32Array;
  /**
   * Generated per-field accessors; fields outside the typed set may be absent
   *
   * No boolean member exists by design — a flag write like `data._dirty = true` must be a compile error, not a silent
   * no-op property.
   */
  [field: string]: number | ArrayLike<number> | undefined;
}

/**
 * Constructor for a generated, schema-specific {@link MaterialData} class
 * @internal
 */
type MaterialDataClass = new (material: BaseMaterial3D) => MaterialData;

const classCache = new Map<string, MaterialDataClass>();

/**
 * Build (or return the cached) data class for a packed Material struct definition
 *
 * The class is generated once per unique layout — prototype accessors over computed offsets, so
 * instances are plain allocations with a shared hidden class and every access is
 * inline-cacheable.
 *
 * Throws when the layout exceeds the store-buffer stride — at construction, the earliest
 * possible moment, with the field table in the message.
 * @param def - Merged Material struct definition from the construction bit list
 * @param snapshot - Cache key (the material's `_materialStructSnapshot`)
 * @returns The generated (or cached) data class for the layout
 * @internal
 */
export function getOrCreateMaterialDataClass(def: StructDefinition, snapshot: string): MaterialDataClass {
  const cached = classCache.get(snapshot);
  if (cached) return cached;

  const layout = createStructLayout(def);

  if (layout.size > MATERIAL_STRIDE_FLOATS * 4) {
    throw new Error(
      `[createMaterialDataClass] Material struct uses ${Math.ceil(layout.size / 4)} floats but the store ` +
        `stride is ${MATERIAL_STRIDE_FLOATS} — writes would overflow into adjacent material slots. ` +
        `Trim or pack material fields:\n${formatStructLayout(layout)}`,
    );
  }

  class GeneratedMaterialData {
    public readonly _f32: Float32Array;
    public readonly _u32: Uint32Array;
    public readonly _material: BaseMaterial3D;
    /**
     * Lazily-created vector subarray views, one per vector field
     *
     * Public so the prototype accessors (defined outside the class body) can reach it.
     */
    public readonly _views: Record<string, Float32Array> = Object.create(null);

    constructor(material: BaseMaterial3D) {
      this._material = material;
      const buffer = new ArrayBuffer(MATERIAL_STRIDE_FLOATS * 4);
      this._f32 = new Float32Array(buffer);
      this._u32 = new Uint32Array(buffer);
    }
  }

  const prototype = GeneratedMaterialData.prototype;

  for (const element of layout.elements) {
    // GPU-only stride padding — no public accessor.
    if (element.name === '_pad') continue;

    const floatOffset = element.offset / 4;
    const { components } = element;

    if (components === 1) {
      const integer = element.type === 'u32' || element.type === 'i32';
      Object.defineProperty(prototype, element.name, {
        enumerable: true,
        get(this: GeneratedMaterialData): number {
          return (integer ? this._u32 : this._f32)[floatOffset];
        },
        set(this: GeneratedMaterialData, value: number) {
          const words = integer ? this._u32 : this._f32;
          // A float slot rounds what it stores, so compare against the rounded value or an inexact
          // number like 0.3 never matches. Rounding an integer to float32 would merge distinct values.
          if (words[floatOffset] === (integer ? value : Math.fround(value))) return;
          words[floatOffset] = value;
          this._material.update();
        },
      });
    } else {
      const end = floatOffset + components;
      const name = element.name;
      Object.defineProperty(prototype, name, {
        enumerable: true,
        get(this: GeneratedMaterialData): Float32Array {
          return (this._views[name] ??= this._f32.subarray(floatOffset, end));
        },
        set(this: GeneratedMaterialData, value: ArrayLike<number>) {
          // Writing through the bounded view keeps an oversized source a
          // loud RangeError instead of silent neighbour corruption.
          (this._views[name] ??= this._f32.subarray(floatOffset, end)).set(value);
          this._material.update();
        },
      });
    }
  }

  const cls = GeneratedMaterialData as unknown as MaterialDataClass;
  classCache.set(snapshot, cls);
  return cls;
}
