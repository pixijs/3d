import type { BaseDestroyOptions, TextureDestroyOptions, TypeOrBool } from 'pixi.js';

/**
 * What a 3D node's `destroy()` takes down with it
 *
 * The flags are pixi.js's `children`, `texture` and `textureSource`, plus `geometry` and
 * `material` for meshes. Every flag defaults to `false`, because children, geometry, materials and
 * textures are often shared: a plain `destroy()` leaves them all alive. A boolean sets every flag
 * at once, so `true` also destroys resources that other nodes still use. A node that destroys its
 * children passes them the same options.
 *
 * `texture` frees the textures of the materials this call destroys. A {@link Mesh3D} destroys its
 * material only when `material` is set, so there `texture` alone frees nothing and `material`
 * alone keeps the textures. A {@link Sprite3D} is the exception: `texture` always frees the
 * sprite's own texture. `textureSource` extends `texture` to the sources behind the textures and,
 * as in pixi.js, frees nothing by itself.
 *
 * Resources a node built for itself are always destroyed, whatever the flags: a {@link View3D}'s
 * GPU resources, a {@link BatchedMesh3D}'s batch, the material a {@link Sprite3D} made for its
 * texture.
 * @example
 * ```ts
 * sprite.destroy({ texture: true });               // the sprite, the material it built, its texture
 * mesh.destroy({ geometry: true, material: true }); // keeps the material's textures
 * model.destroy(true);                               // everything it can reach, shared or not
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
       * @example
       * ```ts
       * mesh.destroy({ geometry: true });
       * ```
       */
      geometry?: boolean;
      /**
       * Destroy each destroyed mesh's {@link BaseMaterial3D}; its textures follow `texture` /
       * `textureSource`
       * @default false
       * @example
       * ```ts
       * mesh.destroy({ material: true, texture: true });
       * ```
       */
      material?: boolean;
    }
>;

/**
 * Resolves one flag from a {@link Destroy3DOptions} value, whether it is a boolean, an object or missing
 * @param options - the options a `destroy()` call received
 * @param key - which flag to read
 * @internal
 */
export function resolveDestroy3DFlag(
  options: Destroy3DOptions | undefined,
  key: keyof Exclude<Destroy3DOptions, boolean>,
): boolean {
  if (typeof options === 'boolean') return options;
  return options?.[key] ?? false;
}
