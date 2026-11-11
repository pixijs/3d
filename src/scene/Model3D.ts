import { definedProps } from 'pixi.js';

import { AnimationPlayer } from '../animation/AnimationPlayer';
import type { AnimationTarget } from '../animation/AnimationPlayer';
import type { Scene3DNode } from '../assets/Scene3DDescriptor';
import { Scene3DSource } from '../assets/Scene3DSource';
import type { Geometry3D } from '../geometry/Geometry3D';
import type { BaseMaterial3D } from '../materials/BaseMaterial3D';
import { Matrix4 } from '../math/matrix/Matrix4';
import { Quaternion } from '../math/rotation/Quaternion';
import { Vector3 } from '../math/vector/Vector3';
import type { Destroy3DOptions } from '../utils/Destroy3DOptions';
import { BatchedMesh3D } from './BatchedMesh3D';
import { Camera3D } from './cameras/Camera3D';
import { Container3D } from './Container3D';
import type { Container3DOptions } from './Container3D';
import { DirectionalLight } from './lights/DirectionalLight';
import { PointLight } from './lights/PointLight';
import { SpotLight } from './lights/SpotLight';
import { Mesh3D } from './Mesh3D';
import { Skeleton } from './Skeleton';

const _matrix = new Matrix4();
const _position = new Vector3();
const _quaternion = new Quaternion();
const _scale = new Vector3();

/** Skips a nested `Model3D`, whose own `unload` already freed its materials during the walk */
function collectMaterials(node: Container3D, out: Set<BaseMaterial3D>): void {
  if (node instanceof Mesh3D) {
    out.add(node.material);
  } else if (node instanceof BatchedMesh3D) {
    const items = node.batch.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].material) out.add(items[i].material);
    }
  }

  const children = node.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!(child instanceof Model3D)) collectMaterials(child, out);
  }
}

interface ModelBuild {
  nodeMap: Record<number, AnimationTarget>;
  /**
   * Each skinned mesh's glTF node index, mapped to its skin's parent node; one never drives a bone,
   * since it holds the bind shape matrix in place of the node's pose
   */
  detachedSkinnedNodes: Map<number, number>;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

/**
 * The materials a {@link Model3D} draws instead of its source's
 *
 * - A record, by material {@link BaseMaterial3D#label | label}: every source material with that
 *   label is replaced. The glTF loader labels materials with their names in the file.
 * - An array, by index into {@link Scene3DSource#materials}; an empty entry keeps the source's.
 * - A function, called once for each source material, returning the material to draw instead.
 * @example
 * ```ts
 * new Model3D({ source, materials: { Paint: redPaint } });
 * new Model3D({ source, materials: (material) => material.clone({ extraBits: [dissolveBit] }) });
 * ```
 * @category scene
 * @standard
 */
export type MaterialOverrides =
  | Readonly<Record<string, BaseMaterial3D>>
  | readonly (BaseMaterial3D | undefined)[]
  | ((material: BaseMaterial3D) => BaseMaterial3D);

interface BuiltMesh {
  mesh: Mesh3D;
  /** Index into {@link Scene3DSource#materials} of the material it draws when nothing replaces it */
  index: number;
}

/**
 * Each of `materials` with `overrides` applied
 *
 * A function runs once per distinct material, so a material listed at several indices gets one
 * replacement and its meshes keep sharing a batch.
 * @param materials - The source's materials
 * @param overrides - What replaces them
 * @returns One material per source index.
 */
function applyMaterialOverrides(materials: readonly BaseMaterial3D[], overrides: MaterialOverrides): BaseMaterial3D[] {
  if (typeof overrides === 'function') {
    const replaced = new Map<BaseMaterial3D, BaseMaterial3D>();

    return materials.map((material) => {
      let replacement = replaced.get(material);
      if (!replacement) replaced.set(material, (replacement = overrides(material)));

      return replacement;
    });
  }

  if (Array.isArray(overrides)) return materials.map((material, i) => overrides[i] ?? material);

  const byLabel = overrides as Readonly<Record<string, BaseMaterial3D>>;

  return materials.map((material) => (material.label !== undefined && byLabel[material.label]) || material);
}

/**
 * Options for building a {@link Model3D} from a shared {@link Scene3DSource}
 * @example
 * ```ts
 * const robot = new Model3D({
 *   source: await Assets.load<Scene3DSource>('robot.glb'),
 *   scene: 'Showroom',
 *   castShadow: false,
 *   label: 'robot',
 * });
 * ```
 * @category scene
 * @standard
 */
export interface Model3DOptions extends Container3DOptions {
  /**
   * The loaded file to build the model from
   * @example
   * ```ts
   * const robot = new Model3D({ source: await Assets.load<Scene3DSource>('robot.glb') });
   * ```
   */
  source: Scene3DSource;
  /**
   * Name of the scene to build, one of the keys of {@link Scene3DSource#scene}
   *
   * Left out, or a name the file doesn't have, it's the file's default scene, or its first when
   * the file names no default.
   * @example
   * ```ts
   * const showroom = new Model3D({ source, scene: 'Showroom' });
   * ```
   */
  scene?: string;
  /**
   * Whether the model's meshes cast shadows
   * @default true
   * @example
   * ```ts
   * const grass = new Model3D({ source, castShadow: false });
   * ```
   */
  castShadow?: boolean;
  /**
   * Whether the model's meshes receive shadows
   * @default true
   * @example
   * ```ts
   * const lamp = new Model3D({ source, receiveShadow: false });
   * ```
   */
  receiveShadow?: boolean;
  /**
   * Whether the model's {@link Model3D#player | player} advances on `Ticker.shared`
   *
   * Set it to `false` to call {@link AnimationPlayer#update} from your own loop.
   * @default true
   * @example
   * ```ts
   * const robot = new Model3D({ source, autoUpdate: false });
   *
   * app.ticker.add((ticker) => robot.player?.update(ticker));
   * ```
   */
  autoUpdate?: boolean;
  /**
   * Animation the model starts playing once built
   *
   * `true` plays the file's first animation, and a string plays the animation with that label.
   * Ignored when the file has no animations.
   * @default false
   * @example
   * ```ts
   * const robot = new Model3D({ source, autoPlay: 'Idle' });
   * ```
   */
  autoPlay?: boolean | string;
  /**
   * Materials the model draws instead of its source's, by label, by index or through a function
   *
   * Left out, the model draws the source's materials, shared with every model built from it. A
   * function is called once for each source material, so meshes that shared one share its
   * replacement. Changing {@link Model3D#materials} later never destroys the materials given here,
   * even ones a function made, so destroy the ones you made when you're done with them.
   * `destroy({ children: true, material: true })` destroys whatever the model's meshes draw at that
   * moment, these included.
   * @example
   * ```ts
   * const enemy = new Model3D({ source, materials: (material) => material.clone() });
   * ```
   */
  materials?: MaterialOverrides;
}

/**
 * A {@link Container3D} built from a loaded glTF file, a {@link Scene3DSource}
 *
 * It builds the file's scene as nodes: meshes, lights, cameras and empty containers, with a
 * {@link Skeleton} for each skin and an {@link AnimationPlayer} when the file has animations.
 * Geometry, materials and textures stay on the source and are shared, so a model is cheap: build
 * as many from one source as you need for crowds, props or repeated assets. A value written to a
 * shared material shows on every model; {@link Model3D#materials} gives one model materials of its
 * own.
 *
 * A bone with no mesh below it isn't built as a node; it lives only in its skeleton, and anything
 * else under it, such as a light, moves up to the nearest built node, so it doesn't follow the
 * bone. A skinned mesh moves under the lowest node above its skin's joints, and its bounds and
 * hit volume measure the bind pose.
 * @example
 * ```ts
 * import { Assets } from 'pixi.js';
 * import { Model3D, type Scene3DSource } from '@pixi/3d';
 *
 * const source = await Assets.load<Scene3DSource>('robot.glb');
 * const robot = new Model3D(source);
 *
 * view3d.root.addChild(robot);
 * robot.position.set(0, 0, -5);
 *
 * if (robot.player) {
 *   const [walk] = robot.player.animationLabels;
 *   robot.player.play(walk);
 * }
 * ```
 * @see {@link Model3DOptions} For per-instance overrides.
 * @see {@link Container3D.traverse} For changing every node it built.
 * @category scene
 * @standard
 */
export class Model3D extends Container3D {
  /**
   * Defaults for every new `Model3D`; an option passed as `undefined` keeps its default
   * @example
   * ```ts
   * Model3D.defaultOptions.castShadow = false;
   * const robot = new Model3D(source); // picks up the override above
   * ```
   */
  public static defaultOptions: Partial<Model3DOptions> = {
    castShadow: true,
    receiveShadow: true,
    autoUpdate: true,
    autoPlay: false,
  };

  /**
   * The source this model was built from, shared with every other model built from it
   * @example
   * ```ts
   * const twin = new Model3D(robot.source);
   * ```
   */
  public readonly source: Scene3DSource;

  /**
   * Plays the file's animations on this model; `undefined` when the file has none
   * @example
   * ```ts
   * robot.player?.play('Walk');
   * ```
   */
  public player?: AnimationPlayer;

  /**
   * One {@link Skeleton} per skin in the file, in file order, with skins that have the same joints
   * and inverse bind matrices counted once; empty when it has none
   * @example
   * ```ts
   * const skeleton = robot.skeletons[0];
   * const head = skeleton.indexOf('Head');
   * ```
   */
  public skeletons: Skeleton[] = [];

  /**
   * The cameras in the built scene, in the order they were built; empty when the file has none
   *
   * Each sits where the file placed it. {@link View3D.from} makes the first one the view's camera
   * unless you pass one.
   * @example
   * ```ts
   * if (model.cameras.length > 0) view3d.camera = model.cameras[0];
   * ```
   */
  public cameras: Camera3D[] = [];

  private readonly _builtMeshes: BuiltMesh[] = [];

  /** What `materials` resolved to, one per source index; unset while the model draws the source's */
  private _materials?: BaseMaterial3D[];

  /** @param options - The source to build from, or {@link Model3DOptions} with it. */
  constructor(options: Model3DOptions | Scene3DSource) {
    if (options instanceof Scene3DSource) options = { source: options };

    const {
      source,
      scene: sceneName,
      castShadow,
      receiveShadow,
      autoUpdate,
      autoPlay,
      hitVolume,
      width,
      height,
      depth,
      parent,
      materials,
      ...rest
    } = {
      ...Model3D.defaultOptions,
      ...definedProps(options),
    };

    super({ label: 'Model3D', ...rest });

    this.source = source;
    if (materials) this._materials = applyMaterialOverrides(source.materials, materials);

    const descriptor = source._descriptor;
    const skeletons = this.skeletons;
    const build: ModelBuild = { nodeMap: {}, detachedSkinnedNodes: new Map(), castShadow, receiveShadow };
    const { nodeMap, detachedSkinnedNodes } = build;

    if (descriptor.skins) {
      descriptor.skins.forEach((s) => {
        const skeleton = new Skeleton({
          parent: s.skeletonParent,
          joints: s.skeletonJoints,
          inverseBindMatrices: s.inverseBindMatrices,
          labels: s.skeletonLabels,
          bindShapeMatrix: s.bindShapeMatrix,
        });

        skeletons.push(skeleton);

        if (!s.skeletonNodes) return;

        for (let i = 0; i < s.skeletonNodes.length; i++) {
          const gltfNodeIndex = s.skeletonNodes[i];
          const node = descriptor.nodes?.[gltfNodeIndex];

          if (node) {
            const t = node.position;
            const r = node.rotation;
            const sc = node.scale;

            skeleton.setLocalTRS(
              i,
              t?.[0] ?? 0,
              t?.[1] ?? 0,
              t?.[2] ?? 0,
              r?.[0] ?? 0,
              r?.[1] ?? 0,
              r?.[2] ?? 0,
              r?.[3] ?? 1,
              sc?.[0] ?? 1,
              sc?.[1] ?? 1,
              sc?.[2] ?? 1,
            );
          }

          nodeMap[gltfNodeIndex] = { skeleton, boneIndex: i };
        }
      });
    }

    if (descriptor.scenes && descriptor.scenes.length > 0) {
      let scene = descriptor.scenes[descriptor.defaultScene ?? 0];

      if (sceneName) {
        scene = source.scene[sceneName] || scene;
      }

      if (scene.children) {
        scene.children.forEach((nodeIndex) => {
          const nodes = this._createNode(nodeIndex, build);

          if (nodes.length) this.addChild(...nodes);
        });
      }
    } else if (descriptor.nodes) {
      if (descriptor.nodes.length > 0) {
        const nodes = this._createNode(0, build);
        if (nodes.length) this.addChild(...nodes);
      }
    }

    for (const [index, parentNode] of detachedSkinnedNodes) {
      const skinParent = nodeMap[parentNode];

      (skinParent instanceof Container3D ? skinParent : this).addChild(nodeMap[index] as Container3D);
    }

    if (descriptor.skins) {
      for (let skinIdx = 0; skinIdx < descriptor.skins.length; skinIdx++) {
        const skeleton = skeletons[skinIdx];
        const skeletonNodes = descriptor.skins[skinIdx].skeletonNodes;

        if (!skeletonNodes) continue;

        for (let i = 0; i < skeletonNodes.length; i++) {
          const nodeIndex = skeletonNodes[i];

          if (detachedSkinnedNodes.has(nodeIndex)) continue;

          const mapped = nodeMap[nodeIndex];

          if (mapped instanceof Container3D) skeleton.bindContainerBone(i, mapped);
        }
      }
    }

    const animationKeys = Object.keys(source.animations);

    if (animationKeys.length) {
      this.player = new AnimationPlayer({
        target: this,
        animations: source.animations,
        nodeMap,
        autoUpdate,
        autoPlay,
      });
    }

    if (hitVolume !== undefined) this.hitVolume = hitVolume;
    if (width !== undefined) this.width = width;
    if (height !== undefined) this.height = height;
    if (depth !== undefined) this.depth = depth;
    parent?.addChild(this);
  }

  private _createMesh(nodeData: Scene3DNode, build: ModelBuild): Container3D {
    const primitives = this.source.geometries[nodeData.geometry!];

    if (!primitives) return new Container3D();

    const materialIndices = nodeData.materials || [];
    const skeleton = nodeData.skin !== undefined ? this.skeletons[nodeData.skin] : undefined;

    const targetCount = primitives[0]?.morphTargetCount ?? 0;
    /**
     * Shared by every primitive, as glTF morphs them by the same weights (§3.7.2.2); a container of
     * primitives carries it too, so the node's `weights` animation channel reaches each one
     */
    let weights: Float32Array | undefined;
    if (targetCount > 0) {
      weights = new Float32Array(targetCount);
      if (nodeData.weights && nodeData.weights.length === targetCount) weights.set(nodeData.weights);
    }

    const makeMesh = (geometry: Geometry3D, i: number) => {
      const index = materialIndices[i];
      const mesh = new Mesh3D({
        geometry,
        material: this.materials[index],
        skeleton,
        castShadow: build.castShadow,
        receiveShadow: build.receiveShadow,
        weights,
      });

      this._builtMeshes.push({ mesh, index });

      return mesh;
    };

    if (primitives.length === 1) return makeMesh(primitives[0], 0);

    const container = new Container3D();

    primitives.forEach((geometry, i) => container.addChild(makeMesh(geometry, i)));

    if (weights) (container as Container3D & { /** @internal */ weights?: Float32Array }).weights = weights;

    return container;
  }

  private _createLight(nodeData: Scene3DNode): Container3D {
    const lightData = this.source._descriptor.lights?.[nodeData.light!];

    if (!lightData) return new Container3D();

    const { type, color, intensity, range, coneAngle, penumbra } = lightData;

    if (type === 0) return new DirectionalLight({ color, intensity });
    if (type === 1) return new PointLight({ color, intensity, range });
    if (type === 2) return new SpotLight({ color, intensity, range, coneAngle, penumbra });

    return new Container3D();
  }

  private _createCamera(nodeData: Scene3DNode): Container3D {
    const cameraData = this.source._descriptor.cameras?.[nodeData.camera!];

    if (!cameraData) return new Container3D();

    const { mode, fov, near, far, orthographicSize } = cameraData;
    const camera = new Camera3D({
      mode: mode === 1 ? 'orthographic' : 'perspective',
      fov,
      near,
      far,
      orthographicSize,
    });

    this.cameras.push(camera);

    return camera;
  }

  private _createNode(index: number, build: ModelBuild): Container3D[] {
    const descriptor = this.source._descriptor;
    const nodeData = descriptor.nodes?.[index];

    if (!nodeData) return [];

    const childContainers = nodeData.children?.flatMap((child) => this._createNode(child, build)) ?? [];

    if (nodeData.isJoint) return childContainers;

    let container: Container3D;

    if (nodeData.geometry !== undefined) {
      container = this._createMesh(nodeData, build);
    } else if (nodeData.light !== undefined) {
      container = this._createLight(nodeData);
    } else if (nodeData.camera !== undefined) {
      container = this._createCamera(nodeData);
    } else {
      container = new Container3D();
    }

    const skin = nodeData.skin !== undefined ? descriptor.skins?.[nodeData.skin] : undefined;
    /**
     * The joint matrices already run up to the skin's parent node, so a skinned mesh moves there and
     * ignores its own node transform, as glTF requires (§3.7.3.2)
     */
    const detachSkinned = skin !== undefined && nodeData.geometry !== undefined;

    if (detachSkinned) {
      if (skin.bindShapeMatrix) {
        _matrix.fromArray(skin.bindShapeMatrix).decompose(_position, _quaternion, _scale);
        container.position.copyFrom(_position);
        container.quaternion.copyFrom(_quaternion);
        container.scale.copyFrom(_scale);
      }
    } else {
      if (nodeData.position) container.position.fromArray(nodeData.position);
      if (nodeData.scale) container.scale.fromArray(nodeData.scale);
      if (nodeData.rotation) container.quaternion.fromArray(nodeData.rotation);
    }

    if (nodeData.label) container.label = nodeData.label;

    if (nodeData.visible === false) container.visible = false;

    if (childContainers.length) container.addChild(...childContainers);

    build.nodeMap[index] = container;

    if (detachSkinned) {
      build.detachedSkinnedNodes.set(index, skin.parentNode ?? -1);

      return [];
    }

    return [container];
  }

  /**
   * The material each source index draws on this model, in the order of
   * {@link Scene3DSource#materials}
   *
   * It's the source's own list until the model is given materials, so a value written to an entry
   * shows on every model that draws it. Assign a {@link MaterialOverrides} record, array or
   * function to give the model materials of its own; the meshes it built switch at once.
   * `undefined` goes back to the source's. Assigning sets every mesh the model built that's still
   * in it, including one whose material you changed yourself, so reapply those afterwards if you
   * want them back. A mesh you moved out of the model keeps what it draws.
   *
   * Assigning never destroys the materials it replaces: destroy the ones you made when you're done
   * with them. Copies a function made are listed only here, so take them from this list, leaving
   * out the source's own, before you assign again.
   * @example
   * ```ts
   * const dissolving = source.materials.map((material) => material.clone({ extraBits: [dissolveBit] }));
   *
   * enemy.materials = dissolving; // on death; every enemy can share these copies
   * enemy.materials = undefined; // back to the source's
   * ```
   */
  public get materials(): readonly BaseMaterial3D[] {
    return this._materials ?? this.source.materials;
  }

  /**
   * Gives the model materials of its own, or the source's back with `undefined`, and switches the
   * meshes it built that are still in it
   * @param value - What replaces the source's materials.
   */
  public set materials(value: MaterialOverrides | undefined) {
    this._materials = value && applyMaterialOverrides(this.source.materials, value);

    const materials = this.materials;
    for (const { mesh, index } of this._builtMeshes) {
      let node = mesh.parent;
      while (node && node !== this) node = node.parent;
      if (node) mesh.material = materials[index];
    }
  }

  /**
   * Builds a `Model3D` from a source; the same as `new Model3D({ ...options, source })`
   * @example
   * ```ts
   * const robot = Model3D.from(source, { castShadow: false, autoPlay: 'Idle' });
   * ```
   * @param source - The source to build from.
   * @param options - Per-instance overrides; see {@link Model3DOptions}.
   */
  public static from(source: Scene3DSource, options?: Omit<Model3DOptions, 'source'>): Model3D {
    return new Model3D({ ...options, source });
  }

  /**
   * Unloads this model's geometry, materials and textures, for a model out of use for a while
   *
   * The textures free their GPU memory; {@link Geometry3D.unload} says what the geometry frees.
   * Nothing is lost: rendering the model again uploads everything and draws the same image. The
   * geometry and materials are shared with every model built from the same source, and they're
   * unloaded all the same; those models upload them again when they next draw.
   * @example
   * ```ts
   * view.root.removeChild(robot);
   * robot.unload(); // geometry and textures both come back on the next render
   * ```
   * @see {@link Model3D.destroy} For permanent teardown.
   */
  public override unload(): void {
    super.unload();

    const materials = new Set<BaseMaterial3D>();
    collectMaterials(this, materials);
    for (const material of materials) material.unload();
  }

  /**
   * Destroys this model, its animation player and its skeletons
   *
   * The skeletons go whatever the flags, but a skinned mesh you keep from the model still draws.
   * The nodes follow `children` as on any {@link Container3D}. The {@link Model3D#source | source}
   * is never destroyed, since other models can share it, and its geometry, materials and textures
   * go only when you pass their flags along with `children`.
   * @example
   * ```ts
   * robot.destroy({ children: true });
   * ```
   * @param options - Teardown flags; see {@link Destroy3DOptions}.
   */
  public override destroy(options?: Destroy3DOptions): void {
    if (this.destroyed) return;

    this.player?.destroy();
    this.player = undefined;

    for (const skeleton of this.skeletons) skeleton.destroy();
    (this.skeletons as Skeleton[] | null) = null;
    (this.cameras as Camera3D[] | null) = null;
    (this._builtMeshes as BuiltMesh[] | null) = null;
    this._materials = undefined;

    super.destroy(options);
  }
}
