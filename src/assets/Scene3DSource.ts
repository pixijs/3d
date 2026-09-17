import type { Texture } from 'pixi.js';

import type { Animation } from '../animation/Animation';
import { SHARED_DEFAULT_TEXTURES } from '../core/textures/DefaultTextures';
import type { Geometry3D } from '../geometry/Geometry3D';
import type { BaseMaterial3D } from '../materials/BaseMaterial3D';
import type { Scene3DDescriptor, Scene3DEntry } from './Scene3DDescriptor';

/**
 * The shared, immutable result of loading a 3D model file (glTF or GLB)
 *
 * A source holds the geometries, materials, textures and animations decoded from the file, plus
 * an internal descriptor of the scene hierarchy.
 *
 * A source is a *template*; spawn live scene-graph instances from it with `new Model3D(source)`.
 * The source itself is never added to a `View3D`. Many instances share the same source, so
 * geometries, materials and textures stay deduplicated across the scene.
 *
 * Resources are exposed in two parallel forms: by integer index (`textures`, `materials`,
 * `geometries`) and by source-file name (`texture`, `material`, `geometry`). The indexed form is
 * exhaustive; the name-keyed form contains only entries that had names in the source file.
 * @example
 * ```ts
 * import { Assets } from 'pixi.js';
 * import { Model3D, Scene3DSource } from '@pixi/3d';
 *
 * const source = await Assets.load<Scene3DSource>('robot.glb');
 *
 * // Spawn two independent instances sharing the same geometry, material and textures
 * const robotA = new Model3D(source);
 * const robotB = new Model3D(source);
 *
 * view3d.root.addChild(robotA, robotB);
 *
 * // Lookup a named resource
 * const helmet = source.material['Helmet'];
 * ```
 * @see {@link Model3D} For the live scene-graph instance type
 * @category assets
 * @standard
 */
export class Scene3DSource {
  /** Every texture, indexed by its source-file index */
  public readonly textures: Texture[] = [];

  /** Every material, indexed by its source-file index */
  public readonly materials: BaseMaterial3D[] = [];

  /**
   * Primitive geometries indexed by their source-file mesh index
   *
   * Each mesh may have multiple primitives, so the outer index resolves to an array.
   */
  public readonly geometries: Geometry3D[][] = [];

  /** Textures keyed by their source-file name; a subset of {@link Scene3DSource#textures} */
  public readonly texture: Record<string, Texture> = {};

  /** Materials keyed by their source-file name; a subset of {@link Scene3DSource#materials} */
  public readonly material: Record<string, BaseMaterial3D> = {};

  /**
   * Single-primitive geometries keyed by their source-file mesh name
   *
   * Multi-primitive meshes are only addressable through {@link Scene3DSource#geometries}.
   */
  public readonly geometry: Record<string, Geometry3D> = {};

  /** Animation clips keyed by their source-file name */
  public readonly animations: Record<string, Animation> = {};

  /**
   * Scenes keyed by name
   *
   * When `Model3DOptions.scene` is omitted, the source's default scene
   * (`Scene3DDescriptor.defaultScene`, from the file's own default-scene index) is instantiated.
   */
  public readonly scene: Record<string, Scene3DEntry> = {};

  /** Whether {@link Scene3DSource.destroy} has run */
  public destroyed = false;

  /**
   * Hierarchy descriptor the {@link Model3D} constructor builds its scene graph from
   * @internal
   */
  public readonly _descriptor: Scene3DDescriptor;

  /**
   * URLs of the images the loader cached for this source; the parser's `unload` unloads them
   * @internal
   */
  public readonly _imageUrls: string[] = [];

  /**
   * Creates a new `Scene3DSource`
   *
   * Loaders construct the source first, then populate the resource maps; user code should never
   * call this directly.
   * @param descriptor - The parsed hierarchy descriptor
   */
  constructor(descriptor: Scene3DDescriptor) {
    this._descriptor = descriptor;

    if (descriptor.scenes) {
      descriptor.scenes.forEach((scene) => {
        if (scene.name) {
          this.scene[scene.name] = scene;
        }
      });
    }
  }

  /**
   * Frees everything this source owns and releases its references to them
   *
   * Destroys every geometry (with its GPU buffers), every material, and every texture with its
   * `TextureSource`, except the shared defaults (`Texture.WHITE`, `Texture.EMPTY` and the flat
   * normal map) that every material falls back to. Animations are plain keyframe data, so they're
   * simply released. A second call does nothing.
   *
   * Every {@link Model3D} spawned from this source draws these resources, so destroy or stop
   * rendering those models first. For a source that came from `Assets.load`, call
   * `Assets.unload(url)` instead: it destroys the source and also unloads every image the file
   * referenced from the loader's cache, as pixi's spritesheets do with their image, even when
   * another loaded asset still uses one.
   * @example
   * ```ts
   * const source = await Assets.load<Scene3DSource>('robot.glb');
   * const robot = new Model3D(source);
   *
   * // Later, once no model from it is rendered any more
   * robot.destroy();
   * await Assets.unload('robot.glb'); // calls source.destroy()
   * ```
   */
  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    for (const primitives of this.geometries) {
      if (primitives) for (const geometry of primitives) geometry.destroy(true);
    }

    for (const material of this.materials) material?.destroy();

    // Several glTF textures can point at one image, so the same Texture may appear more than once.
    // The shared defaults are process-global singletons every material falls back to, so they stay.
    for (const texture of this.textures) {
      if (texture && !texture.destroyed && !SHARED_DEFAULT_TEXTURES.has(texture)) texture.destroy(true);
    }

    (this.geometries as Geometry3D[][] | null) = null;
    (this.materials as BaseMaterial3D[] | null) = null;
    (this.textures as Texture[] | null) = null;
    (this._imageUrls as string[] | null) = null;
    (this.geometry as Record<string, Geometry3D> | null) = null;
    (this.material as Record<string, BaseMaterial3D> | null) = null;
    (this.texture as Record<string, Texture> | null) = null;
    (this.animations as Record<string, Animation> | null) = null;
    (this.scene as Record<string, Scene3DEntry> | null) = null;
  }
}
