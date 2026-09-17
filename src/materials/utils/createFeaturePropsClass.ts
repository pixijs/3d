import { Color } from 'pixi.js';
import type { Texture } from 'pixi.js';

import type { BaseMaterial3D } from '../BaseMaterial3D';
import { linearToSrgb, writeLinearRgb } from '../BaseMaterial3D';
import type { MaterialData } from './createMaterialDataClass';

/**
 * How one runtime prop of a feature-props object binds to the packed material data
 *
 * - `lane` — one float of a packed vec field (`clearcoatParams[1]`).
 * - `scalar` — a whole scalar struct field; delegates to the generated
 *   {@link MaterialData} accessor (which compare-skips and marks dirty).
 * - `colour` — the first three lanes of a vec field. Follows the
 *   `Container.tint` convention: the setter takes any colour source (decoded
 *   to linear light via `writeLinearRgb`), the getter returns the
 *   canonical hex number. Linear channel values live in `material.data`.
 * - `texture` — a named texture slot, dispatched through the material so the
 *   batcher's texture cache key is invalidated. A `readonly` texture is fixed
 *   at construction (its slot may not exist) and so exposes no setter.
 * @internal
 */
type FeaturePropBinding =
  | { kind: 'lane'; field: string; lane: number }
  | { kind: 'scalar'; field: string }
  | { kind: 'colour'; field: string }
  | { kind: 'texture'; slot: string; readonly?: boolean };

/**
 * Name-keyed binding schema consumed by `createFeaturePropsClass`
 * @internal
 */
type FeaturePropsSchema = Record<string, FeaturePropBinding>;

/**
 * Build a feature-props class from a binding schema
 *
 * The generated class is the runtime mirror of a construction option group
 * (`material.clearcoat.roughness = 0.2`). Accessors live on the prototype
 * (plain getter/setter dispatch, no Proxy traps), so property access JITs
 * like any ordinary object; instances hold only the material/data refs and
 * pre-sliced colour views.
 *
 * The schema is keyed by the props interface, so a missing or misspelled
 * binding is a compile error — a typo would otherwise fail silently (writes
 * land on a plain own property and never reach the packed data).
 *
 * The material constructs one instance per feature group it was built with;
 * absence of the group object *is* the feature lock.
 * @param schema - One binding per prop of the props interface `T`
 * @returns A constructor producing bound props objects for a material
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
    /** Owning material — texture props dispatch through it */
    public readonly _material: BaseMaterial3D;
    /** The material's packed data object; value props write here */
    public readonly _data: MaterialData;
    /** Pre-sliced 3-wide linear-light write views, one per colour prop */
    public readonly _colours: Record<string, Float32Array> = Object.create(null);
    /** Canonical hex per colour prop — the tint-convention read-back */
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
            // Vector fields are always float32 views, which round what they store. Compare against
            // the rounded value or an inexact number like 0.3 never matches.
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
        // A `readonly` texture is fixed at construction — e.g. its presence
        // selects a shader variant, so the slot may not exist and
        // `material.textures` is sealed. It gets no setter; reading an absent
        // slot returns `undefined`. Mutable textures keep their setter.
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
