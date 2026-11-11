import type { BaseDestroyOptions, TextureDestroyOptions, TypeOrBool } from 'pixi.js';

/**
 * What a 3D node's `destroy()` takes down with it
 *
 * The flags are pixi.js's `children`, `texture` and `textureSource`, plus `geometry` and
 * `material` for meshes. Each defaults to `false`, since children, geometries, materials and
 * textures are often shared. `true` sets every flag, so it also destroys resources other nodes
 * still use. A node passes the same options to the children it destroys.
 *
 * `texture` frees the textures of the materials the call destroys, so on a {@link Mesh3D},
 * `texture` alone frees nothing and `material` alone keeps the textures. On a {@link Sprite3D},
 * `texture` always frees the sprite's texture. `textureSource` also frees the sources behind those
 * textures and, as in pixi.js, does nothing alone.
 *
 * What a node made for itself always goes, whatever the flags: a {@link View3D}'s GPU resources,
 * a {@link BatchedMesh3D}'s batch, the material a {@link Sprite3D} built for its texture.
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

/** @internal */
export function resolveDestroy3DFlag(
  options: Destroy3DOptions | undefined,
  key: keyof Exclude<Destroy3DOptions, boolean>,
): boolean {
  if (typeof options === 'boolean') return options;
  return options?.[key] ?? false;
}
