import { Color } from 'pixi.js';
import type { Texture } from 'pixi.js';

import type { BaseMaterial3D } from '../BaseMaterial3D';
import { linearToSrgb, writeLinearRgb } from '../BaseMaterial3D';
import type { MaterialData } from './createMaterialDataClass';

type FeaturePropBinding =
  | { kind: 'lane'; field: string; lane: number }
  | { kind: 'scalar'; field: string }
  | { kind: 'colour'; field: string }
  | { kind: 'texture'; slot: string; readonly?: boolean };

type FeaturePropsSchema = Record<string, FeaturePropBinding>;

/**
 * Builds the class behind a feature-props object such as `material.clearcoat`; lane setters compare
 * with `Math.fround(value)`, or re-setting an inexact value like 0.3 would queue an upload each time
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
    public readonly _colours: Record<string, Float32Array> = Object.create(null);
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

/**
 * Read a feature-props object back as a plain object of its props, such as the `clearcoat` options
 * `clone` passes to the copy's constructor
 *
 * The names come from the prototype, where {@link createFeaturePropsClass} defines every prop of the
 * schema as enumerable, so they can't drift from the getters. The instance's own fields
 * (`_material`, `_data`, the colour views) aren't on the prototype, so they stay out. A `readonly`
 * texture prop the group was built without reads `undefined`.
 * @param props - An instance of a class {@link createFeaturePropsClass} built
 * @returns Each prop's current value, by name
 * @internal
 */
export function readFeatureProps<T extends object>(props: T): T {
  const values: Partial<T> = {};
  for (const name of Object.keys(Object.getPrototypeOf(props)) as (keyof T)[]) values[name] = props[name];

  return values as T;
}
