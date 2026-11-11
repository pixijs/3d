import type { Texture } from 'pixi.js';

import type { Animation } from '../animation/Animation';
import { SHARED_DEFAULT_TEXTURES } from '../core/textures/DefaultTextures';
import type { Geometry3D } from '../geometry/Geometry3D';
import type { BaseMaterial3D } from '../materials/BaseMaterial3D';
import type { Scene3DDescriptor, Scene3DEntry } from './Scene3DDescriptor';

/**
 * The geometries, materials, textures and animations loaded from a glTF or GLB file
 *
 * A source is a template: add `new Model3D(source)` to a view, never the source itself. Every model
 * spawned from one source shares its geometries, materials and textures, so a change to a source
 * material shows on every model that draws it. {@link Model3D#materials} gives one model materials
 * of its own.
 *
 * The plural lists (`textures`, `materials`, `geometries`) hold everything, by index in the file.
 * The singular records (`texture`, `material`, `geometry`) hold only what the file named.
 *
 * {@link loadGltf} lists the texture formats a file can use and the imports they need.
 * @example
 * ```ts
 * import { Assets } from 'pixi.js';
 * import { Model3D, Scene3DSource } from '@pixi/3d';
 *
 * const source = await Assets.load<Scene3DSource>('robot.glb');
 *
 * // Two models sharing the same geometry, materials and textures
 * const robotA = new Model3D(source);
 * const robotB = new Model3D(source);
 *
 * view3d.root.addChild(robotA, robotB);
 *
 * // Repaints both robots
 * source.material['Helmet'].baseColor = 0xff0000;
 * ```
 * @category assets
 * @standard
 */
export class Scene3DSource {
  /**
   * Every texture, by its index in the file
   *
   * Textures in the file that use the same image share one `Texture` and its style, so an entry can
   * repeat. The file's samplers set the style, and glTF's defaults (repeat wrapping, linear
   * filtering, mipmaps) fill whatever a sampler leaves out.
   * @example
   * ```ts
   * for (const texture of source.textures) texture.source.style.maxAnisotropy = 8;
   * ```
   */
  public readonly textures: Texture[] = [];

  /**
   * Every material, by its index in the file
   *
   * Unlit materials load as {@link FlatMaterial}, the rest as {@link Material3D}. When a mesh
   * primitive names no material, the glTF default material, a white `Material3D` with `metallic` and
   * `roughness` at 1, is added after the file's own.
   * @example
   * ```ts
   * const pbrMaterials = source.materials.filter((material) => material instanceof Material3D);
   * ```
   */
  public readonly materials: BaseMaterial3D[] = [];

  /**
   * Every mesh's geometries, by its index in the file: one per primitive of the mesh
   * @example
   * ```ts
   * const [body, glass] = source.geometries[0];
   * ```
   */
  public readonly geometries: Geometry3D[][] = [];

  /**
   * The textures the file names, keyed by name
   * @example
   * ```ts
   * const logo = new Sprite(source.texture['Logo']);
   * ```
   */
  public readonly texture: Record<string, Texture> = {};

  /**
   * The materials the file names, keyed by name
   * @example
   * ```ts
   * source.material['Paint'].baseColor = 0x3366ff;
   * ```
   */
  public readonly material: Record<string, BaseMaterial3D> = {};

  /**
   * The geometry of each mesh the file names, keyed by mesh name
   *
   * A mesh with several primitives maps to its first; {@link Scene3DSource#geometries} has them all.
   * @example
   * ```ts
   * const rock = new Mesh3D({ geometry: source.geometry['Rock'], material: new Material3D() });
   * ```
   */
  public readonly geometry: Record<string, Geometry3D> = {};

  /**
   * Animation clips keyed by name; an unnamed clip is keyed `anim_<index>`
   * @example
   * ```ts
   * const walkSeconds = source.animations['Walk'].duration;
   * ```
   */
  public readonly animations: Record<string, Animation> = {};

  /**
   * The scenes the file names, keyed by name
   *
   * Pass a name as {@link Model3DOptions#scene} to spawn that scene instead of the default one.
   * @example
   * ```ts
   * const showroom = new Model3D({ source, scene: 'Showroom' });
   * ```
   */
  public readonly scene: Record<string, Scene3DEntry> = {};

  /**
   * Whether {@link Scene3DSource#destroy} has run
   * @example
   * ```ts
   * if (!source.destroyed) view3d.root.addChild(new Model3D(source));
   * ```
   */
  public destroyed = false;

  /** @internal */
  public readonly _descriptor: Scene3DDescriptor;

  /**
   * Cache keys of the file's images, which the loader's `unload` releases
   * @internal
   */
  public readonly _imageUrls: string[] = [];

  /** @internal */
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
   * Destroys every geometry, material and texture the source holds; a second call does nothing
   *
   * Every {@link Model3D} spawned from this source draws these resources, so destroy or stop
   * rendering those models first. For a source from `Assets.load`, call `Assets.unload(url)`
   * instead. It destroys the source and also unloads every image the file referenced from the
   * loader's cache, even when another loaded asset still uses one.
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
