import type { ColorSource } from 'pixi.js';

/** @internal */
export interface Scene3DDescriptor {
  scenes?: Scene3DEntry[];

  /** Unset means the first scene */
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

/** @internal */
export interface Scene3DNode {
  /** The node's name in the file, or `node_<index>` when it has none */
  label: string;
  children: number[];
  position?: Float32Array;
  rotation?: Float32Array;
  scale?: Float32Array;
  camera?: number;
  /** Index into `Scene3DSource.geometries` */
  geometry?: number;
  /** Indices into `Scene3DSource.materials`, one per primitive */
  materials?: number[];
  light?: number;
  skin?: number;
  weights?: number[];
  /** A skeleton node with no mesh below it, which `Model3D` builds no container for */
  isJoint?: boolean;
  visible?: boolean;
}

/** @internal */
export interface Scene3DCamera {
  /** In degrees */
  fov?: number;
  near: number;
  /** Unset for an infinite projection */
  far?: number;
  orthographicSize?: number;
  /** `0` = perspective, `1` = orthographic */
  mode: number;
}

/** @internal */
export interface Scene3DLight {
  name?: string;
  /** In sRGB, which the loader encodes from glTF's linear colour */
  color?: ColorSource;
  intensity?: number;
  /** `0` = directional, `1` = point, `2` = spot */
  type: number;
  /** `0` means infinite */
  range?: number;
  /** In degrees */
  coneAngle?: number;
  penumbra?: number;
}

/** @internal */
export interface Scene3DSkin {
  name?: string;
  inverseBindMatrices: Float32Array;

  /** Parent of each skeleton node, as an index into the skeleton; `-1` for a root */
  skeletonParent: Int16Array;

  /** The file's node index of each skeleton node */
  skeletonNodes: Int32Array;

  /** The skeleton index of each joint, in the order `JOINTS_0` refers to them */
  skeletonJoints: Int16Array;

  skeletonLabels?: string[];

  /** The file node the skin's meshes hang from, above every joint; `-1` or unset for the model's root */
  parentNode?: number;

  /**
   * The skin's mesh transform at bind, relative to `parentNode`; unset for the identity. `Model3D`
   * gives it to both the meshes and the `Skeleton`, which cancels it
   */
  bindShapeMatrix?: Float32Array;
}
