import { Color } from 'pixi.js';
import type { Texture } from 'pixi.js';

import type { BaseMaterial3D } from '../BaseMaterial3D';
import { linearToSrgb, writeLinearRgb } from '../BaseMaterial3D';
import type { MaterialData } from './createMaterialDataClass';

/**
 * How one prop of a feature-props object reaches the material
 *
 * - `lane`: one float of a vector field, such as `clearcoatParams[1]`.
 * - `scalar`: a whole scalar field, through the generated {@link MaterialData} accessor.
 * - `colour`: the first three lanes of a vector field. Like `Container.tint`, it takes any colour
 *   source and reads back as a hex number; the field holds the colour in linear light.
 * - `texture`: a named texture slot, written through `material.textures`. A `readonly` one gets
 *   no setter, because its slot is fixed at construction and may not exist.
 * @internal
 */
type FeaturePropBinding =
  | { kind: 'lane'; field: string; lane: number }
  | { kind: 'scalar'; field: string }
  | { kind: 'colour'; field: string }
  | { kind: 'texture'; slot: string; readonly?: boolean };

type FeaturePropsSchema = Record<string, FeaturePropBinding>;

/**
 * Build the class behind a runtime feature-props object, such as `material.clearcoat`
 *
 * Each prop becomes a getter and setter on the prototype, so props read like plain fields and an
 * instance holds only its material, data and colour views. The schema is keyed by the props
 * interface, so a missing or misspelt binding is a compile error rather than a write that never
 * reaches the material.
 *
 * Lane setters compare against `Math.fround(value)`. Vector fields are float32 views, which round
 * what they store, so an inexact number like 0.3 would never match and every write would queue an
 * upload.
 *
 * A material builds one instance per feature group it was constructed with.
 * @param schema - One binding per prop of the props interface `T`
 * @internal
 */
export function createFeaturePropsClass<T>(
  schema: Record<keyof T, FeaturePropBinding>,
): new (material: BaseMaterial3D) => T {
  const bindings = Object.entries(schema as FeaturePropsSchema);
  const colourBindings = bindings.filter(([, binding]) => binding.kind === 'colour') as [
    string,
    { kind: 'colour'; field: string },
  ][];

  class FeatureProps {
    public readonly _material: BaseMaterial3D;
    public readonly _data: MaterialData;
    /** Each colour prop's three lanes, cut once at construction */
    public readonly _colours: Record<string, Float32Array> = Object.create(null);
    /** The hex value each colour prop reads back */
    public readonly _tints: Record<string, number> = Object.create(null);

    constructor(material: BaseMaterial3D) {
      this._material = material;
      this._data = material.data;
      for (const [name, binding] of colourBindings) {
        const view = (this._data[binding.field] as Float32Array).subarray(0, 3);
        this._colours[name] = view;
        this._tints[name] = Color.shared
          .setValue([linearToSrgb(view[0]), linearToSrgb(view[1]), linearToSrgb(view[2])])
          .toNumber();
      }
    }
  }

  for (const [name, binding] of bindings) {
    let descriptor: PropertyDescriptor;
    switch (binding.kind) {
      case 'lane': {
        const { field, lane } = binding;
        descriptor = {
          get(this: FeatureProps): number {
            return (this._data[field] as Float32Array)[lane];
          },
          set(this: FeatureProps, value: number) {
            const view = this._data[field] as Float32Array;
            if (view[lane] === Math.fround(value)) return;
            view[lane] = value;
            this._material.update();
          },
        };
        break;
      }
      case 'scalar': {
        const { field } = binding;
        descriptor = {
          get(this: FeatureProps): number {
            return this._data[field] as number;
          },
          set(this: FeatureProps, value: number) {
            this._data[field] = value;
          },
        };
        break;
      }
      case 'colour':
        descriptor = {
          get(this: FeatureProps): number {
            return this._tints[name];
          },
          set(this: FeatureProps, value: Parameters<Color['setValue']>[0]) {
            const colour = Color.shared.setValue(value);
            this._tints[name] = colour.toNumber();
            writeLinearRgb(this._colours[name], 0, colour);
            this._material.update();
          },
        };
        break;
      case 'texture': {
        const { slot } = binding;
        descriptor = {
          get(this: FeatureProps): Texture | undefined {
            return this._material.textures[slot];
          },
        };
        if (!binding.readonly) {
          descriptor.set = function (this: FeatureProps, value: Texture): void {
            this._material.textures[slot] = value;
          };
        }
        break;
      }
    }
    descriptor.enumerable = true;
    descriptor.configurable = false;
    Object.defineProperty(FeatureProps.prototype, name, descriptor);
  }

  return FeatureProps as new (material: BaseMaterial3D) => T;
}
