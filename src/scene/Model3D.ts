import { definedProps, RAD_TO_DEG } from 'pixi.js';

import { AnimationPlayer } from '../animation/AnimationPlayer';
import type { AnimationTarget } from '../animation/AnimationPlayer';
import type { Scene3DNode } from '../assets/Scene3DDescriptor';
import { Scene3DSource } from '../assets/Scene3DSource';
import type { Geometry3D } from '../geometry/Geometry3D';
import type { BaseMaterial3D } from '../materials/BaseMaterial3D';
import { Material3D } from '../materials/pbr/Material3D';
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
 * Gathers the distinct materials worn by the meshes under `node`, so each is unloaded once. A nested
 * `Model3D` child is not descended into: its own `unload` already handled its materials during the walk.
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
  /** The shared source to build the scene graph from; required */
  source: Scene3DSource;
  /**
   * Name of the scene to instantiate
   *
   * Defaults to the source's default scene (glTF `scene`, or the first scene when the file
   * names none). Names match `Scene3DSource.scene` keys.
   */
  scene?: string;
  /**
   * Whether the instantiated meshes cast shadows
   * @default true
   */
  castShadow?: boolean;
  /**
   * Whether the instantiated meshes receive shadows
   * @default true
   */
  receiveShadow?: boolean;
  /**
   * Whether the created animation player uses `Ticker.shared` for playback
   *
   * Set to `false` when driving playback manually via `AnimationPlayer.update`.
   * @default true
   */
  autoUpdate?: boolean;
  /**
   * Animation the created animation player starts on construction
   *
   * `true` plays the source's first animation, and a string plays the animation with that label.
   * Ignored when the source has no animations.
   * @default false
   */
  autoPlay?: boolean | string;
}

/**
 * The `Model3D` object is a `Container3D` instantiated from a shared {@link Scene3DSource}
 *
 * It owns the scene-graph nodes (meshes, lights, cameras, empties) produced by walking the
 * source's hierarchy descriptor, plus the `AnimationPlayer` and `Skeleton`s needed to drive them.
 *
 * `Model3D` instances are cheap; the heavy data (geometries, materials, textures) lives on the
 * shared source. Spawn many models from one source for crowds, props, or repeated assets.
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
   * `new Model3D(opts)` resolves as `{ ...Model3D.defaultOptions, ...opts }`. Mutate to change the
   * defaults process-wide.
   *
   * `source` and `scene` have no meaningful default (the source's default scene is picked when
   * `scene` is omitted) and are intentionally absent here.
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
   * The shared `Scene3DSource` this model was instantiated from
   *
   * Useful for spawning more instances (`new Model3D(model.source)`) and for tooling that
   * needs to trace a model back to its origin asset.
   */
  public readonly source: Scene3DSource;

  /**
   * Animation player driving this model's `Skeleton`s and direct `Container3D` channels
   *
   * Present only when the source contains at least one animation clip.
   */
  public player?: AnimationPlayer;

  /**
   * Skeletons created from the source's skin descriptors
   *
   * One entry per `Scene3DSkin`, in source order. Empty when the model has no skinned meshes.
   */
  public skeletons: Skeleton[] = [];

  /**
   * Cameras created from the source's camera nodes, in the order the scene graph was built
   *
   * Each one sits in this model's scene graph at its authored transform. Install one with
   * `view.camera = model.cameras[0]`; {@link View3D.from} does that for you. Empty when the file
   * has no cameras.
   */
  public cameras: Camera3D[] = [];

  /**
   * Builds the model's scene graph from a shared source
   *
   * Walks the source's hierarchy descriptor, instantiates the scene graph (meshes, lights,
   * cameras, empties), constructs one `Skeleton` per skin, and attaches an `AnimationPlayer`
   * when the source has animations.
   *
   * Joint nodes are not materialized as `Container3D`s; their transforms live on the `Skeleton`
   * and are applied during skinning. Their non-joint descendants are hoisted to the nearest
   * non-joint ancestor.
   * @param options - The source to build from, or {@link Model3DOptions} with it.
   */
  constructor(options: Model3DOptions | Scene3DSource) {
    if (options instanceof Scene3DSource) options = { source: options };

    // Held back until the model is built: `hitVolume` shorthands and `width` / `height` / `depth`
    // measure the instantiated nodes, and attaching to a live `parent` must see a finished model.
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

    // Map from GLTF Node Index -> Animation Target
    const nodeMap: Record<number, AnimationTarget> = {};

    // Skinned meshes, detached from the glTF hierarchy and parented to the model
    // root once the graph is built (see `createNode`).
    const skinnedRoots: Container3D[] = [];

    // glTF node indices of those detached meshes. A detached mesh has its node
    // transform suppressed, so it must never drive a container bone — even when it
    // also appears in a skin's `skeletonNodes` (a mesh node that parents joints).
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

        // Seed each bone's local TRS from its glTF node and map it back to the
        // original node index. Without the TRS seed, bones whose channels are
        // pruned by tools like gltfpack render at identity and break bind pose.
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

      // One weights array shared by every primitive of this mesh, so a single
      // 'weights' animation channel (or manual edit) drives them together.
      const targetCount = primitives[0]?.morphTargetCount ?? 0;
      let weights: Float32Array | undefined;
      if (targetCount > 0) {
        weights = new Float32Array(targetCount);
        if (nodeData.weights && nodeData.weights.length === targetCount) weights.set(nodeData.weights);
      }

      const makeMesh = (geometry: Geometry3D, i: number) =>
        new Mesh3D({
          geometry,
          material: source.materials[materialIndices[i] ?? 0] || source.materials[0] || new Material3D({}),
          skeleton,
          castShadow,
          receiveShadow,
          weights,
        });

      if (primitives.length === 1) return makeMesh(primitives[0], 0);

      const container = new Container3D();

      primitives.forEach((geometry, i) => container.addChild(makeMesh(geometry, i)));

      // Expose the shared weights on the wrapper so a node-level 'weights'
      // animation channel binds here; the array is the same reference each
      // child mesh reads, so updates propagate to all primitives.
      if (weights) (container as Container3D & { /** @internal */ weights?: Float32Array }).weights = weights;

      return container;
    };

    const createLight = (nodeData: Scene3DNode): Container3D => {
      const lightData = descriptor.lights?.[nodeData.light!];

      if (!lightData) return new Container3D();

      // `type` picks the class and the node supplies the label; each kind takes only the options it declares.
      const { type, color, intensity, range, coneAngle, penumbra } = lightData;

      if (type === 0) return new DirectionalLight({ color, intensity });
      if (type === 1) return new PointLight({ color, intensity, range });
      if (type === 2) return new SpotLight({ color, intensity, range, coneAngle, penumbra });

      return new Container3D();
    };

    const createCamera = (nodeData: Scene3DNode): Container3D => {
      const cameraData = descriptor.cameras?.[nodeData.camera!];

      if (!cameraData) return new Container3D();

      // glTF stores the vertical field of view in radians and leaves `far` out for an infinite
      // projection; Camera3D takes degrees and falls back to its default far plane.
      const camera = new Camera3D({ fov: cameraData.fov * RAD_TO_DEG, near: cameraData.near, far: cameraData.far });

      this.cameras.push(camera);

      return camera;
    };

    const createNode = (index: number): Container3D[] => {
      const nodeData = descriptor.nodes?.[index];

      if (!nodeData) return [];

      const childContainers = nodeData.children?.flatMap(createNode) ?? [];

      // Joints live in the Skeleton, not the scene graph. Hoist any visible
      // descendants up to the nearest non-joint ancestor — the joint's own
      // transform is already applied through bone matrices during skinning.
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

      // When a skin omits glTF `skeleton`, its joint matrices are collected in
      // model space (full chain to root), and the shader applies
      // `modelMatrix * skinMatrix`. Keeping the mesh in its glTF position would
      // double-apply that chain, so it is detached to the model root (below) with
      // its own node transform ignored, per the glTF spec, leaving `modelMatrix`
      // as only the scene-level framing transform. Skins that DO specify a
      // skeleton root are bounded, so their meshes keep their node transform.
      const skin = nodeData.skin !== undefined ? descriptor.skins?.[nodeData.skin] : undefined;
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
      // No scene defined (glTF without `scenes`): treat the first node as the root.
      if (descriptor.nodes.length > 0) {
        const nodes = createNode(0);
        if (nodes.length) this.addChild(...nodes);
      }
    }

    if (skinnedRoots.length) this.addChild(...skinnedRoots);

    // Shared ancestor nodes kept in the scene graph (above) double as skeleton
    // bones. Their transforms may be animated on the scene-graph container, so
    // bind each such bone to its container; the skeleton re-reads the animated
    // local TRS each frame instead of staying frozen at the bind pose. Detached
    // skinned meshes are skipped: their node transform is suppressed, so driving a
    // bone from one would overwrite its bind pose with identity.
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
   * Builds a `Model3D` from a shared source; the same as `new Model3D({ ...options, source })`
   * @param source - The source to instantiate from.
   * @param options - Per-instance overrides; see {@link Model3DOptions}.
   * @returns The instantiated model
   */
  public static from(source: Scene3DSource, options?: Omit<Model3DOptions, 'source'>): Model3D {
    return new Model3D({ ...options, source });
  }

  /**
   * Give back everything this model put on the GPU — for a model that is out of rotation for a
   * while. Runs {@link Container3D.unload | the subtree walk} for the geometry, then unloads
   * each distinct material found under it, which is what frees the textures. A nested model
   * unloads its own materials during the walk, so they are not collected again here.
   *
   * Nothing here is destructive: every mesh keeps its vertex data and every texture its source
   * image, so re-adding the model (or rendering it again) re-uploads and renders it identically
   * after one frame's work.
   *
   * A material shared with meshes outside this model is unloaded all the same — see
   * {@link BaseMaterial3D.unload} for what that means for the other holders (they re-upload on
   * next use). Same for geometry shared with another model.
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
   * Tears down this model
   *
   * Stops and disposes the {@link Model3D.player | player} (releasing its `Ticker.shared`
   * listener) and destroys every owned {@link Skeleton} (freeing each skeleton's GPU buffer),
   * then runs {@link Container3D.destroy | super.destroy} to detach and recurse.
   *
   * The shared {@link Model3D.source | source} is never destroyed — many models can reference the
   * same source. By default the owned scene-graph nodes' geometry / material / textures (which also
   * live on the shared source) are left intact; pass the matching flags to cascade their destruction.
   * @param options - Teardown flags; see {@link Destroy3DOptions}.
   */
  public override destroy(options?: Destroy3DOptions): void {
    if (this.destroyed) return;

    this.player?.destroy();
    this.player = undefined;

    // Skeletons are freed unconditionally (not gated on `children`): a skeleton's
    // `buffer` is never bound to the render path — skinning reads the View's
    // BonePit via `_bonePitIndex`, which copies the CPU `worldMatrix` — so a
    // detached-but-retained skinned mesh does not use-after-free here.
    for (const skeleton of this.skeletons) skeleton.destroy();
    this.skeletons.length = 0;
    // The cameras are destroyed by the subtree walk below; only the index is released here.
    this.cameras.length = 0;

    super.destroy(options);
  }
}
