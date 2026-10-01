import type { ColorSource } from 'pixi.js';

/**
 * The scene hierarchy of a loaded file, as plain data the {@link Model3D} constructor turns into
 * scene-graph nodes
 *
 * Nodes refer to everything by index: to cameras, lights and skins in this descriptor, and to
 * geometries and materials in the {@link Scene3DSource} that owns it.
 * @internal
 */
export interface Scene3DDescriptor {
  scenes?: Scene3DEntry[];

  /** The scene a {@link Model3D} spawns when `Model3DOptions.scene` doesn't name one; unset means the first */
  defaultScene?: number;

  nodes?: Scene3DNode[];

  cameras?: Scene3DCamera[];

  lights?: Scene3DLight[];

  skins?: Scene3DSkin[];
}

/**
 * A scene from the file: its name and its root nodes
 * @category assets
 * @advanced
 */
export interface Scene3DEntry {
  /** The scene's name in the file, when it has one */
  name?: string;
  /** Indices of the scene's root nodes in the file */
  children?: number[];
}

/**
 * One node of the file: its local transform and what it holds
 * @internal
 */
export interface Scene3DNode {
  /** The node's name in the file, or `node_<index>` when it has none */
  label: string;
  children: number[];
  position?: Float32Array;
  /** Quaternion `[x, y, z, w]` */
  rotation?: Float32Array;
  scale?: Float32Array;
  camera?: number;
  /** Index into `Scene3DSource.geometries`: the node's mesh */
  geometry?: number;
  /** Indices into `Scene3DSource.materials`, one per primitive of the mesh */
  materials?: number[];
  light?: number;
  skin?: number;
  /** Starting morph-target weights: the node's own when it has them, else its mesh's */
  weights?: number[];
  /**
   * Set on skeleton nodes with no mesh beneath them
   *
   * {@link Model3D} builds no container for such a node and lifts its children to the nearest
   * container above; the node's `Skeleton` applies its transform instead.
   */
  isJoint?: boolean;
  /** `false` when `KHR_node_visibility` hides the node and everything under it */
  visible?: boolean;
}

/**
 * A camera, which {@link Model3D} builds as a `Camera3D` at each node that refers to it
 * @internal
 */
export interface Scene3DCamera {
  /** Vertical field of view in radians */
  fov: number;
  near: number;
  /** Unset for an infinite projection */
  far?: number;
  aspectRatio?: number;
  /** `0` = perspective, the only kind loaded */
  mode: number;
}

/**
 * A light, which {@link Model3D} builds at each node that refers to it
 * @internal
 */
export interface Scene3DLight {
  name?: string;
  /** Encoded to sRGB by the loader, as glTF light colours are linear */
  color?: ColorSource;
  intensity?: number;
  /** `0` = directional, `1` = point, `2` = spot */
  type: number;
  /** `0` means infinite */
  range?: number;
  /** Half-angle of a spot cone, in degrees */
  coneAngle?: number;
  penumbra?: number;
}

/**
 * A skin, from which {@link Model3D} builds one `Skeleton`
 *
 * The skeleton lists the skin's joints plus their ancestors up to the skeleton root, parents
 * before children.
 * @internal
 */
export interface Scene3DSkin {
  name?: string;
  /** One 4x4 matrix (16 floats) per joint, in `skeletonJoints` order */
  inverseBindMatrices: Float32Array;

  /** Parent of each skeleton node, as an index into the skeleton; `-1` for a root */
  skeletonParent: Int16Array;

  /**
   * The file's node index for each skeleton node
   *
   * Animation tracks target the file's nodes, so this routes them to bones.
   */
  skeletonNodes: Int32Array;

  /** The skeleton index of each joint, in skinning order */
  skeletonJoints: Int16Array;

  /** Label of each skeleton node, which animations bound by name look up */
  skeletonLabels?: string[];

  /**
   * True when the skin names no `skeleton` root, so its skeleton reaches up to the scene root and
   * the bone matrices are in model space
   *
   * {@link Model3D} then moves meshes using the skin to the model root and ignores their node
   * transform, which the bone matrices already carry. A skin with a `skeleton` root keeps its
   * meshes' node transforms.
   */
  skeletonToModelRoot: boolean;
}
