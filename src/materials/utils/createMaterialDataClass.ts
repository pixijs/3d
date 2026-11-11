import { WORDS_PER_TEXEL } from '../../core/buffers/dataTextureLayout';
import { createStructLayout } from '../../core/shader/codegen/structLayout';
import type { StructDefinition } from '../../core/shader/ShaderBit';
import type { BaseMaterial3D } from '../BaseMaterial3D';

/**
 * A material's GPU-side values, as `material.data`, with a property per field its bits declare
 *
 * - Scalars read and write as numbers.
 * - Vectors read as live `Float32Array` views and are set by copying from any array-like no longer
 *   than the field; a longer one throws. Writing into a view queues no upload, so call
 *   `material.update()` afterwards.
 * - Assigning a field queues an upload; repeat writes in one frame upload once.
 *
 * A material with fixed fields narrows the type, as {@link Material3DData} does.
 * @category materials
 * @advanced
 */
export interface MaterialData {
  /** @internal */
  readonly _f32: Float32Array;
  /**
   * Base colour in linear light, alpha in the last lane; absent when the struct doesn't declare it
   *
   * Set `material.baseColor` and `material.alpha` instead, which keep `displayBaseColor` in step.
   */
  baseColor?: Float32Array;
  /** Base colour in display space, alpha in the last lane, for unlit bits; absent when not declared */
  displayBaseColor?: Float32Array;
  /** Cutoff for `alphaMode: 'mask'`; absent when the struct doesn't declare it */
  alphaCutoff?: number;
  /** The UV transform's 2x2 part, row-major as `[m00, m01, m10, m11]`; absent when the struct doesn't declare it */
  uvTransformRow0?: Float32Array;
  /** The UV transform's offset; absent when the struct doesn't declare it */
  uvOffset?: Float32Array;
  /** Any other field the struct declares */
  [field: string]: number | ArrayLike<number> | undefined;
}

type MaterialDataClass = new (material: BaseMaterial3D) => MaterialData;

const classCache = new Map<string, MaterialDataClass>();

const TEXEL_BYTES = WORDS_PER_TEXEL * 4;

/**
 * Float setters compare with `Math.fround(value)`, integer ones raw since rounding would merge
 * distinct integers; accessors sit on the prototype so each layout has one hidden class
 * @internal
 */
export function getOrCreateMaterialDataClass(def: StructDefinition, snapshot: string): MaterialDataClass {
  const cached = classCache.get(snapshot);
  if (cached) return cached;

  const layout = createStructLayout(def);
  const bytes = Math.max(1, Math.ceil(layout.size / TEXEL_BYTES)) * TEXEL_BYTES;

  class GeneratedMaterialData {
    public readonly _f32: Float32Array;
    public readonly _u32: Uint32Array;
    public readonly _material: BaseMaterial3D;
    public readonly _views: Record<string, Float32Array> = Object.create(null);

    constructor(material: BaseMaterial3D) {
      this._material = material;
      const buffer = new ArrayBuffer(bytes);
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
