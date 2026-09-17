import type { ColorSource } from 'pixi.js';

/**
 * Parsed hierarchy descriptor produced by the asset loaders
 *
 * Internal to the loading pipeline; consumed by the {@link Model3D} constructor to walk the scene graph and
 * instantiate `Container3D` / `Mesh3D` / `Light` nodes.
 *
 * Fields are arrays of plain data referenced by index from sibling fields (a node references a
 * geometry by `geometry: 1`, a material by `materials: [3]`, a light by `light: 0`, etc.). The
 * corresponding live resources live on the {@link Scene3DSource} that owns this descriptor.
 * @internal
 */
export interface Scene3DDescriptor {
  /** Top-level scenes, in source-file order, addressable by name through {@link Scene3DSource#scene} */
  scenes?: Scene3DEntry[];

  /**
   * Index into {@link scenes} of the scene {@link Model3D} instantiates when
   * `Model3DOptions.scene` is omitted
   *
   * Defaults to `0` when the file names no default.
   */
  defaultScene?: number;

  /** Flat list of every node in the file; hierarchy is expressed through `Scene3DNode.children` */
  nodes?: Scene3DNode[];

  /** Camera presets referenced by `Scene3DNode.camera` */
  cameras?: Scene3DCamera[];

  /** Light presets referenced by `Scene3DNode.light` */
  lights?: Scene3DLight[];

  /** Skin descriptors referenced by `Scene3DNode.skin`, one per skinned mesh hierarchy */
  skins?: Scene3DSkin[];
}

/**
 * Top-level scene: a named set of root node indices into the descriptor's node list
 *
 * Entries are exposed by name through {@link Scene3DSource#scene}.
 * @category assets
 * @advanced
 */
export interface Scene3DEntry {
  /** Scene name from the source file, when present */
  name?: string;
  /** Indices of this scene's root nodes in the owning descriptor's node list */
  children?: number[];
}

/**
 * A node in the scene-graph hierarchy
 *
 * Holds the local TRS transform plus optional references into the sibling resource lists
 * (`geometry`, `materials`, `light`, `camera`, `skin`).
 *
 * Nodes never directly contain children; `children` is an array of indices into
 * `Scene3DDescriptor.nodes`.
 * @internal
 */
export interface Scene3DNode {
  label: string;
  /** Indices into `Scene3DDescriptor.nodes` of this node's children */
  children: number[];
  /** Local translation `[x, y, z]`; omitted when identity */
  position?: Float32Array;
  /** Local rotation as a quaternion `[x, y, z, w]`; omitted when identity */
  rotation?: Float32Array;
  /** Local scale `[x, y, z]`; omitted when identity */
  scale?: Float32Array;
  /** Index into `Scene3DDescriptor.cameras` */
  camera?: number;
  /** Index into `Scene3DSource.geometries` (the mesh's primitive group) */
  geometry?: number;
  /** Per-primitive material indices into `Scene3DSource.materials`, one per primitive of the geometry */
  materials?: number[];
  /** Index into `Scene3DDescriptor.lights` */
  light?: number;
  /** Index into `Scene3DDescriptor.skins`, set on the mesh node that uses the skin */
  skin?: number;
  /**
   * Default morph-target weights for this node's mesh, one per target. Node
   * weights override the mesh's defaults per the glTF spec.
   */
  weights?: number[];
  /**
   * When true, this node is a joint inside a skeleton hierarchy and is never instantiated as a
   * `Container3D`. Its transform is applied by the `Skeleton`, not the scene graph.
   */
  isJoint?: boolean;
  /** From `KHR_node_visibility`: when false, the node and its descendants are excluded from rendering */
  visible?: boolean;
}

/**
 * Camera preset
 *
 * Currently unused at instantiation time; reserved for future support.
 * @internal
 */
export interface Scene3DCamera {
  fov: number;
  near: number;
  far?: number;
  aspectRatio?: number;
  mode: number;
}

/**
 * Light preset
 *
 * The `type` discriminator picks the runtime light class
 * (`0` = directional, `1` = point, `2` = spot).
 * @internal
 */
export interface Scene3DLight {
  name?: string;
  /** Display-space colour (the loader pre-encodes spec-linear KHR factors) */
  color?: ColorSource;
  intensity?: number;
  /** `0` = directional, `1` = point, `2` = spot */
  type: number;
  range?: number;
  /** Spot cone half-angle in degrees */
  coneAngle?: number;
  penumbra?: number;
}

/**
 * Skin descriptor for a skinned mesh
 *
 * Captures the bind-pose data plus an internal skeleton layout used to map animation tracks to
 * bone indices. {@link Model3D} constructs one `Skeleton` per `Scene3DSkin` at instancing
 * time.
 * @internal
 */
export interface Scene3DSkin {
  name?: string;
  /** Per-joint inverse bind matrices, packed as 16 floats each in skinning order */
  inverseBindMatrices: Float32Array;

  /** Parent index for each node in the internal skeleton array; `-1` marks a skeleton root */
  skeletonParent: Int16Array;

  /**
   * Map from internal skeleton-node index to the original source-file node index
   *
   * Used to route animation tracks (which target source-file node indices) to the right bone.
   */
  skeletonNodes: Int32Array;

  /** Indices into `skeletonNodes` of the actual skinning joints, in skinning order (subset of all skeleton nodes) */
  skeletonJoints: Int16Array;

  /** Node labels indexed by internal skeleton-node index, used for label-based animation binding */
  skeletonLabels?: string[];

  /**
   * True when the skin omitted glTF `skeleton`, so `processSkins` collected the joints'
   * ancestors all the way to the scene root and the bone matrices are in model space
   *
   * Meshes using such a skin are detached to the model root (their node transform ignored) so
   * `modelMatrix` doesn't double-apply the chain the joint matrices already carry. When a
   * `skeleton` root is given, the skeleton is bounded and the skinned mesh keeps its own node
   * transform.
   */
  skeletonToModelRoot: boolean;
}
