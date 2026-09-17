import type { BaseDestroyOptions, TextureDestroyOptions, TypeOrBool } from 'pixi.js';

/**
 * Teardown options for the `destroy()` flow across the 3D scene graph
 *
 * pixi.js's `DestroyOptions` shape, with `geometry` and `material` added for meshes. `texture`
 * acts on the textures of each material that gets destroyed (a {@link Sprite3D}'s own material
 * always is), so `material: true` alone keeps the (often shared) textures. `textureSource` widens
 * `texture` to the sources behind them and, as in 2D, frees nothing without it.
 *
 * A boolean acts as if every flag were set to that value: `true` destroys everything reachable,
 * `false` only exclusively-owned resources. The same options are forwarded unchanged to children
 * during recursion.
 *
 * Every flag defaults to `false`, so shared resources (children, geometry, materials, textures)
 * survive unless asked for. Exclusively-owned GPU resources (a {@link View3D}'s render graph, an
 * owned batch) are always released regardless of these flags.
 * @example
 * ```ts
 * sprite.destroy({ texture: true });               // the sprite, its material and its texture
 * mesh.destroy({ geometry: true, material: true }); // keeps the material's textures
 * model.destroy(true);                               // everything reachable
 * ```
 * @category scene
 * @standard
 */
export type Destroy3DOptions = TypeOrBool<
  BaseDestroyOptions &
    TextureDestroyOptions & {
      /**
       * Destroy each destroyed mesh's {@link Geometry3D} and its GPU buffers
       * @default false
       */
      geometry?: boolean;
      /**
       * Destroy each destroyed mesh's {@link BaseMaterial3D}; its textures follow `texture` /
       * `textureSource`
       * @default false
       */
      material?: boolean;
    }
>;

/**
 * Resolves one flag from a {@link Destroy3DOptions} value
 *
 * A boolean stands in for every flag, otherwise the named flag is read and defaults to `false`.
 * @param options - the destroy options to resolve from
 * @param key - which flag to read
 * @returns The resolved flag value.
 * @internal
 */
export function resolveDestroy3DFlag(
  options: Destroy3DOptions | undefined,
  key: keyof Exclude<Destroy3DOptions, boolean>,
): boolean {
  if (typeof options === 'boolean') return options;
  return options?.[key] ?? false;
}
