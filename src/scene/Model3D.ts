import { definedProps, RAD_TO_DEG } from 'pixi.js';

import { AnimationPlayer } from '../animation/AnimationPlayer';
import type { AnimationTarget } from '../animation/AnimationPlayer';
import type { Scene3DNode } from '../assets/Scene3DDescriptor';
import { Scene3DSource } from '../assets/Scene3DSource';
import type { Geometry3D } from '../geometry/Geometry3D';
import type { BaseMaterial3D } from '../materials/BaseMaterial3D';
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

/**
 * Gathers the distinct materials of the meshes and batch slots under `node`, so each is unloaded
 * once
 *
 * A nested `Model3D` isn't descended into: its own `unload` already handled its materials during
 * the walk.
 * @param node - Subtree root to walk.
 * @param out - Receives each distinct material.
 */
function collectMaterials(node: Container3D, out: Set<BaseMaterial3D>): void {
  if (node instanceof Mesh3D) {
    out.add(node.material);
  } else if (node instanceof BatchedMesh3D) {
    const items = node.items;
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
   * The loaded file to build the model from; required
   * @example
   * ```ts
   * const robot = new Model3D({ source: await Assets.load<Scene3DSource>('robot.glb') });
   * ```
   */
  source: Scene3DSource;
  /**
   * Name of the scene to build, one of the keys of {@link Scene3DSource#scene}
   *
   * Left out, it's the file's default scene, or its first scene when the file names no default.
   * A name the file doesn't have also falls back to the default.
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
}

/**
 * A {@link Container3D} built from a loaded glTF file, a {@link Scene3DSource}
 *
 * It builds the file's scene as nodes: meshes, lights, cameras and empty containers, with a
 * {@link Skeleton} for each skin and an {@link AnimationPlayer} when the file has animations.
 * Geometry, materials and textures stay on the source and are shared, so a model is cheap: build
 * as many from one source as you need for crowds, props or repeated assets.
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
 * @see {@link Scene3DSource} For the shared resource bag this is built from.
 * @see {@link Model3DOptions} For per-instance overrides.
 * @see {@link AnimationPlayer} For the animation runtime attached to {@link Model3D.player}.
 * @see {@link Skeleton} For the bone hierarchies attached to {@link Model3D.skeletons}.
 * @category scene
 * @standard
 */
export class Model3D extends Container3D {
  /**
   * Default {@link Model3DOptions} merged under every constructor call
   *
   * `new Model3D(opts)` resolves as `{ ...Model3D.defaultOptions, ...opts }`, ignoring options set
   * to `undefined`. Mutate to change the defaults process-wide. `source` and `scene` have no
   * default here.
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
   * One {@link Skeleton} per skin in the file, in file order; empty when it has none
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
   * Each sits in the model's scene graph where the file placed it. Make one the view's camera with
   * `view.camera = model.cameras[0]`; {@link View3D.from} does that for you.
   * @example
   * ```ts
   * if (model.cameras.length > 0) view3d.camera = model.cameras[0];
   * ```
   */
  public cameras: Camera3D[] = [];

  /**
   * Builds the model's nodes, skeletons and animation player from a source
   *
   * Each bone starts at its node's pose in the file, so a bone that no animation drives keeps its
   * rest pose; tools such as gltfpack drop the channels of bones that never move. A bone with no
   * mesh below it isn't built as a node: it lives only in its skeleton. Anything else below such a
   * bone, such as a light or an empty, is moved up to the nearest node that is built, so it
   * doesn't follow the bone.
   *
   * A skinned mesh whose skin names no skeleton root is moved to the model's root and its own
   * transform is ignored, as glTF requires (§3.7.3.2): its joints already carry the whole
   * transform. A file with no scenes builds its first node.
   *
   * `hitVolume`, `width`, `height`, `depth` and `parent` are applied last, once the model is
   * built, since they measure or attach the finished model.
   * @param options - The source to build from, or {@link Model3DOptions} with it.
   */
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
      ...rest
    } = {
      ...Model3D.defaultOptions,
      ...definedProps(options),
    };

    super({ label: 'Model3D', ...rest });

    this.source = source;

    const descriptor = source._descriptor;
    const skeletons = this.skeletons;

    /** What each glTF node index animates: its built node, or a bone of a skeleton */
    const nodeMap: Record<number, AnimationTarget> = {};

    /** Skinned meshes taken out of the glTF hierarchy, added to the model root once it's built */
    const skinnedRoots: Container3D[] = [];

    /**
     * The glTF node indices of the meshes in `skinnedRoots`
     *
     * Their node transform is ignored, so one must never drive a bone, even a mesh node that is
     * also a skeleton node because it parents joints: it would overwrite the bone's rest pose
     * with identity.
     */
    const detachedSkinnedNodes = new Set<number>();

    if (descriptor.skins) {
      descriptor.skins.forEach((s) => {
        const skeleton = new Skeleton({
          parent: s.skeletonParent,
          joints: s.skeletonJoints,
          inverseBindMatrices: s.inverseBindMatrices,
          labels: s.skeletonLabels,
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

    const createMesh = (nodeData: Scene3DNode): Container3D => {
      const primitives = source.geometries[nodeData.geometry!];

      if (!primitives) return new Container3D();

      const materialIndices = nodeData.materials || [];
      const skeleton = nodeData.skin !== undefined ? skeletons[nodeData.skin] : undefined;

      const targetCount = primitives[0]?.morphTargetCount ?? 0;
      /**
       * One weights array for every primitive of the mesh, since glTF morphs them all by the same
       * weights (§3.7.2.2)
       *
       * A mesh with several primitives becomes a container of meshes, and the container carries
       * the array as `weights` too, so the node's `weights` animation channel binds there and
       * reaches every primitive.
       */
      let weights: Float32Array | undefined;
      if (targetCount > 0) {
        weights = new Float32Array(targetCount);
        if (nodeData.weights && nodeData.weights.length === targetCount) weights.set(nodeData.weights);
      }

      const makeMesh = (geometry: Geometry3D, i: number) =>
        new Mesh3D({
          geometry,
          material: source.materials[materialIndices[i]],
          skeleton,
          castShadow,
          receiveShadow,
          weights,
        });

      if (primitives.length === 1) return makeMesh(primitives[0], 0);

      const container = new Container3D();

      primitives.forEach((geometry, i) => container.addChild(makeMesh(geometry, i)));

      if (weights) (container as Container3D & { /** @internal */ weights?: Float32Array }).weights = weights;

      return container;
    };

    /**
     * Builds the light a node names
     *
     * `type` picks the class and `createNode` sets the label from the node. Each kind gets
     * only the options it declares.
     * @param nodeData - The node holding the light
     */
    const createLight = (nodeData: Scene3DNode): Container3D => {
      const lightData = descriptor.lights?.[nodeData.light!];

      if (!lightData) return new Container3D();

      const { type, color, intensity, range, coneAngle, penumbra } = lightData;

      if (type === 0) return new DirectionalLight({ color, intensity });
      if (type === 1) return new PointLight({ color, intensity, range });
      if (type === 2) return new SpotLight({ color, intensity, range, coneAngle, penumbra });

      return new Container3D();
    };

    /**
     * Builds the camera a node names and records it in {@link Model3D#cameras}
     *
     * glTF gives the vertical field of view in radians and leaves `zfar` out for an infinite
     * projection (§3.10.3.2). `Camera3D` takes degrees and falls back to its default far plane.
     * @param nodeData - The node holding the camera
     */
    const createCamera = (nodeData: Scene3DNode): Container3D => {
      const cameraData = descriptor.cameras?.[nodeData.camera!];

      if (!cameraData) return new Container3D();

      const camera = new Camera3D({ fov: cameraData.fov * RAD_TO_DEG, near: cameraData.near, far: cameraData.far });

      this.cameras.push(camera);

      return camera;
    };

    /**
     * Builds a node and its subtree, returning what its parent should add
     *
     * A node the loader marked as a joint, a bone with no mesh below it, builds nothing and
     * returns its children's nodes for its parent to adopt; its transform lives in the skeleton.
     * A detached skinned mesh returns nothing and waits in `skinnedRoots`.
     * @param index - glTF node index
     */
    const createNode = (index: number): Container3D[] => {
      const nodeData = descriptor.nodes?.[index];

      if (!nodeData) return [];

      const childContainers = nodeData.children?.flatMap(createNode) ?? [];

      if (nodeData.isJoint) return childContainers;

      let container: Container3D;

      if (nodeData.geometry !== undefined) {
        container = createMesh(nodeData);
      } else if (nodeData.light !== undefined) {
        container = createLight(nodeData);
      } else if (nodeData.camera !== undefined) {
        container = createCamera(nodeData);
      } else {
        container = new Container3D();
      }

      const skin = nodeData.skin !== undefined ? descriptor.skins?.[nodeData.skin] : undefined;
      /**
       * Whether this is a mesh deformed by a skin that names no glTF `skeleton` root
       *
       * Such a skin's joint matrices run up to the model root, and the shader applies
       * `modelMatrix * skinMatrix`. Left where the file put it, the mesh would apply that chain
       * twice, so it moves to the model root with its own node transform ignored, as glTF requires
       * (§3.7.3.2), leaving `modelMatrix` as the model's own transform. A skin that names a root
       * has joint matrices measured from that root, and its meshes keep their node transform.
       */
      const detachSkinned = skin?.skeletonToModelRoot === true && nodeData.geometry !== undefined;

      if (!detachSkinned) {
        if (nodeData.position) container.position.fromArray(nodeData.position);
        if (nodeData.scale) container.scale.fromArray(nodeData.scale);
        if (nodeData.rotation) container.quaternion.fromArray(nodeData.rotation);
      }

      if (nodeData.label) container.label = nodeData.label;

      if (nodeData.visible === false) container.visible = false;

      if (childContainers.length) container.addChild(...childContainers);

      nodeMap[index] = container;

      if (detachSkinned) {
        skinnedRoots.push(container);
        detachedSkinnedNodes.add(index);

        return [];
      }

      return [container];
    };

    if (descriptor.scenes && descriptor.scenes.length > 0) {
      let scene = descriptor.scenes[descriptor.defaultScene ?? 0];

      if (sceneName) {
        scene = source.scene[sceneName] || scene;
      }

      if (scene.children) {
        scene.children.forEach((nodeIndex) => {
          const nodes = createNode(nodeIndex);

          if (nodes.length) this.addChild(...nodes);
        });
      }
    } else if (descriptor.nodes) {
      if (descriptor.nodes.length > 0) {
        const nodes = createNode(0);
        if (nodes.length) this.addChild(...nodes);
      }
    }

    if (skinnedRoots.length) this.addChild(...skinnedRoots);

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

  /**
   * Builds a `Model3D` from a source; the same as `new Model3D({ ...options, source })`
   * @example
   * ```ts
   * const robot = Model3D.from(source, { castShadow: false, autoPlay: 'Idle' });
   * ```
   * @param source - The source to build from.
   * @param options - Per-instance overrides; see {@link Model3DOptions}.
   * @returns The instantiated model
   */
  public static from(source: Scene3DSource, options?: Omit<Model3DOptions, 'source'>): Model3D {
    return new Model3D({ ...options, source });
  }

  /**
   * Frees the GPU memory of this model's geometry, materials and textures, for a model out of use
   * for a while
   *
   * {@link Container3D.unload} frees the geometry under it, then each material under it is
   * unloaded once, which frees its textures. A nested model unloads its own materials during that
   * walk, so they aren't collected again here.
   *
   * Nothing is lost: every mesh keeps its vertex data and every texture its image, so rendering the
   * model again uploads everything and draws the same image.
   *
   * Geometry and materials are often shared with other models from the same source, and they're
   * unloaded all the same; the other models upload them again when they next draw. See
   * {@link BaseMaterial3D.unload}.
   * @example
   * ```ts
   * view.root.removeChild(robot);
   * robot.unload(); // geometry and textures both come back on the next render
   * ```
   * @see {@link Container3D.unload} For the geometry-only walk.
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
   * The player stops and leaves `Ticker.shared`. The skeletons are destroyed whatever the flags;
   * they hold no GPU memory, so a skinned mesh you keep from the model still draws. The nodes, cameras
   * included, follow `children` as on any {@link Container3D}; the {@link Model3D#cameras | cameras}
   * list is emptied either way.
   *
   * The {@link Model3D#source | source} is never destroyed, since other models can share it. Its
   * geometry, materials and textures stay too, unless you pass the matching flags along with
   * `children`.
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
    this.skeletons.length = 0;
    this.cameras.length = 0;

    super.destroy(options);
  }
}
