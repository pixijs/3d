import { MATERIAL_STRIDE_FLOATS } from '../../core/buffers/MaterialDataStoreBuffer';
import { createStructLayout } from '../../core/shader/codegen/structLayout';
import type { StructDefinition } from '../../core/shader/ShaderBit';
import type { BaseMaterial3D } from '../BaseMaterial3D';

/**
 * A material's GPU-side values, as `material.data`
 *
 * One fixed-size buffer laid out exactly as the material's compiled `Material` struct, with an
 * accessor per field:
 *
 * - Scalars read and write as numbers.
 * - Vectors read as live `Float32Array` views into the buffer and are set by copying from any
 *   array-like. Writing into a returned view changes the data without queueing an upload, so
 *   call `material.update()` afterwards.
 * - Setters queue an upload through `material.update()`; repeat writes in one frame upload once.
 *
 * The fields typed here are the ones {@link BaseMaterial3D} reads itself. A material with a fixed
 * struct narrows the type further, as {@link Material3DData} does.
 * @category materials
 * @advanced
 */
export interface MaterialData {
  /**
   * The buffer itself, in the struct's layout
   * @internal
   */
  readonly _f32: Float32Array;
  /** Base colour in linear light, alpha in the last lane; absent when the struct doesn't declare it */
  baseColor?: Float32Array;
  /** Cutoff for `alphaMode: 'mask'`; absent when the struct doesn't declare it */
  alphaCutoff?: number;
  /** The UV transform's 2x2 part, row-major as `[m00, m01, m10, m11]`; absent when the struct doesn't declare it */
  uvTransformRow0?: Float32Array;
  /** The UV transform's offset; absent when the struct doesn't declare it */
  uvOffset?: Float32Array;
  /**
   * Any other field the struct declares
   *
   * The value type has no `boolean`, so a write such as `data._dirty = true` is a compile error
   * rather than a property the GPU never sees.
   */
  [field: string]: number | ArrayLike<number> | undefined;
}

type MaterialDataClass = new (material: BaseMaterial3D) => MaterialData;

const classCache = new Map<string, MaterialDataClass>();

/**
 * Build, or return the cached, data class for a material struct layout
 *
 * One class per layout, with accessors on the prototype over fixed offsets, so every instance
 * shares one hidden class and each access can be inline-cached.
 *
 * Float setters compare against `Math.fround(value)`: a float slot rounds what it stores, so an
 * inexact number like 0.3 would never match. Integer setters compare the raw value, since rounding
 * to float32 would merge distinct integers. Vector setters copy through a view bounded to the
 * field, so an oversized source throws a `RangeError` instead of overwriting the next field.
 * @param def - The merged Material struct from the construction bit list
 * @param snapshot - Cache key, the material's `_materialStructSnapshot`
 * @internal
 */
export function getOrCreateMaterialDataClass(def: StructDefinition, snapshot: string): MaterialDataClass {
  const cached = classCache.get(snapshot);
  if (cached) return cached;

  const layout = createStructLayout(def);

  class GeneratedMaterialData {
    public readonly _f32: Float32Array;
    public readonly _u32: Uint32Array;
    public readonly _material: BaseMaterial3D;
    /** Each vector field's view, made on first access; public so the prototype accessors can reach it */
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
