import { definedProps } from 'pixi.js';

import { BONE_MATRIX_FLOATS } from '../core/buffers/BonePit';
import { Matrix4 } from '../math/matrix/Matrix4';
import type { Container3D } from './Container3D';

/**
 * Constructor options for {@link Skeleton}
 *
 * A {@link Model3D} builds its skeletons from the file's skins, so you only need these to rig a
 * mesh in code. Nodes are numbered from 0, parents before children. `labels` falls back to
 * {@link Skeleton.defaultOptions}.
 * @example
 * ```ts
 * const inverseBindMatrices = new Float32Array(32);
 *
 * inverseBindMatrices.set(new Matrix4().elements, 0);
 * inverseBindMatrices.set(new Matrix4().makeTranslation(0, -1, 0).elements, 16);
 *
 * const options: SkeletonOptions = {
 *   parent: new Int16Array([-1, 0]),
 *   joints: new Int16Array([0, 1]),
 *   inverseBindMatrices,
 *   labels: ['base', 'tip'],
 * };
 * ```
 * @category scene
 * @standard
 */
export interface SkeletonOptions {
  /**
   * Parent of each node, as a node index, or `-1` for a root; its length is the node count
   *
   * A parent must come before its children.
   * @example
   * ```ts
   * const chain = new Skeleton({ parent: new Int16Array([-1, 0, 1]), joints, inverseBindMatrices });
   * ```
   */
  parent: Int16Array;
  /**
   * The nodes that are joints, as node indices; its length is the joint count
   *
   * A skinned geometry's `joints` attribute indexes this list, not the nodes, as glTF's `JOINTS_0`
   * does. Nodes left out only carry the joints below them.
   * @example
   * ```ts
   * const arm = new Skeleton({
   *   parent: new Int16Array([-1, 0, 1]),
   *   joints: new Int16Array([1, 2]),
   *   inverseBindMatrices,
   * });
   * ```
   */
  joints: Int16Array;
  /**
   * One column-major 4x4 matrix per joint, in `joints` order, taking a vertex from the bind pose
   * into the joint's space
   * @example
   * ```ts
   * const inverseBindMatrices = new Float32Array(32);
   *
   * inverseBindMatrices.set(new Matrix4().elements, 0);
   * inverseBindMatrices.set(new Matrix4().makeTranslation(0, -1, 0).elements, 16);
   * ```
   */
  inverseBindMatrices: Float32Array;
  /**
   * A label for each node, in node order, so {@link Skeleton#indexOf | indexOf} can find it
   * @example
   * ```ts
   * const tail = new Skeleton({ parent, joints, inverseBindMatrices, labels: ['base', 'tip'] });
   * const tip = tail.indexOf('tip');
   * ```
   */
  labels?: string[];
}

/**
 * The bones of a skinned {@link Mesh3D}, and their pose
 *
 * A {@link Model3D} builds one per skin in its file and gives it to every mesh that skin deforms,
 * so you rarely build one yourself. The bones are numbered nodes: the joints that deform the mesh,
 * plus the nodes above them. Each node's local position, rotation and scale sit in the flat arrays
 * {@link Skeleton#localPosition | localPosition}, {@link Skeleton#localRotation | localRotation}
 * and {@link Skeleton#localScale | localScale}.
 *
 * To pose a bone, write into those arrays and set {@link Skeleton#dirty | dirty}, or call
 * {@link Skeleton#setLocalTRS | setLocalTRS}, which does both. The view recomputes a dirty
 * skeleton's matrices before it draws. A playing animation rewrites the bones it drives on every
 * update, so a change you make to one of those lasts only until then.
 *
 * A skeleton holds no GPU memory. The view copies its matrices into one buffer it shares between
 * every skeleton it draws.
 * @example
 * ```ts
 * const skeleton = robot.skeletons[0];
 * const head = skeleton.indexOf('Head');
 * const half = Math.PI / 12;
 *
 * // Set the head's local rotation to 30 degrees around Y.
 * skeleton.localRotation.set([0, Math.sin(half), 0, Math.cos(half)], head * 4);
 * skeleton.dirty = true;
 * ```
 * @see {@link Mesh3D} For the renderable that references a Skeleton.
 * @see {@link SkeletonOptions} For constructor options.
 * @category scene
 * @standard
 */
export class Skeleton {
  /**
   * Default {@link SkeletonOptions} merged under every constructor call
   *
   * `new Skeleton(opts)` resolves as `{ ...Skeleton.defaultOptions, ...opts }`, ignoring options
   * set to `undefined`. It starts empty: `parent`, `joints` and `inverseBindMatrices` belong to
   * each skeleton, which leaves only `labels`.
   * @advanced
   */
  public static defaultOptions: Partial<SkeletonOptions> = {};

  /** Number of nodes: the joints plus the nodes above them */
  // oxlint-disable-next-line pixi3d/require-standard-example -- read-only state
  public readonly nodeCount: number = 0;
  /** Number of joints, the nodes that deform the mesh */
  // oxlint-disable-next-line pixi3d/require-standard-example -- read-only state
  public readonly jointCount: number = 0;

  /**
   * Parent of each node, as a node index, or `-1` for a root
   *
   * A {@link Model3D} shares it with every model built from the same source, so don't write into
   * it.
   * @example
   * ```ts
   * const shoulder = skeleton.parent[skeleton.indexOf('UpperArm')];
   * ```
   */
  public readonly parent: Int16Array;
  /**
   * The node index of each joint
   *
   * A {@link Model3D} shares it with every model built from the same source, so don't write into
   * it.
   * @example
   * ```ts
   * const handJoint = skeleton.joints.indexOf(skeleton.indexOf('Hand'));
   * ```
   */
  public readonly joints: Int16Array;

  /**
   * One column-major 4x4 matrix per joint, taking a vertex from the bind pose into the joint's space
   *
   * A {@link Model3D} shares it with every model built from the same source, so don't write into
   * it.
   * @advanced
   */
  public readonly inverseBindMatrices: Float32Array;

  /**
   * Local position of each node, three floats per node: `x, y, z`
   *
   * Set {@link Skeleton#dirty | dirty} after writing into it.
   * @example
   * ```ts
   * const hips = skeleton.indexOf('Hips') * 3;
   *
   * skeleton.localPosition[hips + 1] -= 0.2;
   * skeleton.dirty = true;
   * ```
   */
  public readonly localPosition: Float32Array;
  /**
   * Local rotation of each node, a four-float quaternion per node: `x, y, z, w`
   *
   * Set {@link Skeleton#dirty | dirty} after writing into it.
   * @example
   * ```ts
   * const jaw = skeleton.indexOf('Jaw') * 4;
   *
   * skeleton.localRotation.set([Math.sin(open / 2), 0, 0, Math.cos(open / 2)], jaw);
   * skeleton.dirty = true;
   * ```
   */
  public readonly localRotation: Float32Array;
  /**
   * Local scale of each node, three floats per node: `x, y, z`
   *
   * Set {@link Skeleton#dirty | dirty} after writing into it.
   * @example
   * ```ts
   * const head = skeleton.indexOf('Head') * 3;
   *
   * skeleton.localScale.fill(1.5, head, head + 3);
   * skeleton.dirty = true;
   * ```
   */
  public readonly localScale: Float32Array;

  /**
   * The skinning matrix of each joint, as three rows of four floats, in joint order
   *
   * A joint's skinning matrix is its posed matrix times its inverse bind, row-major:
   * `[m00 m01 m02 m03][m10 m11 m12 m13][m20 m21 m22 m23]`. The bottom row is always
   * `(0, 0, 0, 1)`, so it isn't stored. {@link Skeleton#updateWorld | updateWorld} fills it, and
   * the view copies it to the GPU.
   * @advanced
   */
  public readonly worldMatrix: Float32Array;

  /**
   * Whether the local pose changed since the last {@link Skeleton#updateWorld | updateWorld}
   *
   * Set it after writing into the local arrays; {@link Skeleton#setLocalTRS | setLocalTRS} and
   * animations set it for you. While it's `false`, the view skips recomputing the matrices.
   * @example
   * ```ts
   * skeleton.localScale.fill(1.5, head * 3, head * 3 + 3);
   * skeleton.dirty = true;
   * ```
   */
  public dirty = true;

  /**
   * Base index of this skeleton's matrices in the bone pit of the view drawing it; `-1` until
   * first drawn
   * @internal
   */
  public _bonePitIndex = -1;
  /**
   * The bone pit tick this skeleton was last added on, so a skeleton shared by several meshes is
   * copied into the pit once a frame
   * @internal
   */
  public _bonePitTick = -1;

  private _destroyed = false;

  private readonly _labelToIndex!: Record<string, number>;
  /**
   * Posed matrices of every node, 16 floats each, which {@link Skeleton#updateWorld} builds in
   * one pass and then multiplies by the inverse binds into {@link Skeleton#worldMatrix}
   */
  private readonly _nodeWorldMatrix: Float32Array;

  /**
   * Bones that follow a scene-graph container; see {@link Skeleton#bindContainerBone}
   *
   * Empty for most skeletons, so it costs nothing then.
   * @internal
   */
  private readonly _containerBones: { boneIndex: number; src: Container3D }[] = [];

  /**
   * Creates a skeleton with every node at the identity pose: no translation or rotation, and a
   * scale of 1
   *
   * A {@link Model3D} builds its own; build one to rig a mesh in code.
   * @param options - Construction options; see {@link SkeletonOptions}.
   */
  constructor(options: SkeletonOptions) {
    options = { ...Skeleton.defaultOptions, ...definedProps(options) };

    const { parent, joints, inverseBindMatrices, labels } = options;

    this.nodeCount = parent.length;
    this.jointCount = joints.length;

    this.parent = parent;
    this.joints = joints;
    this.inverseBindMatrices = inverseBindMatrices;

    this.localPosition = new Float32Array(this.nodeCount * 3);
    this.localRotation = new Float32Array(this.nodeCount * 4);
    this.localScale = new Float32Array(this.nodeCount * 3);

    this._nodeWorldMatrix = new Float32Array(this.nodeCount * 16);
    this.worldMatrix = new Float32Array(this.jointCount * BONE_MATRIX_FLOATS);

    for (let i = 0; i < this.nodeCount; i++) {
      this.localRotation[i * 4 + 3] = 1;
      this.localScale[i * 3 + 0] = 1;
      this.localScale[i * 3 + 1] = 1;
      this.localScale[i * 3 + 2] = 1;

      const m = i * 16;
      this._nodeWorldMatrix[m + 0] = 1;
      this._nodeWorldMatrix[m + 5] = 1;
      this._nodeWorldMatrix[m + 10] = 1;
      this._nodeWorldMatrix[m + 15] = 1;
    }

    if (labels) {
      this._labelToIndex = Object.create(null);
      for (let i = 0; i < labels.length; i++) this._labelToIndex[labels[i]] = i;
    }
  }

  /**
   * Returns the index of the node with a label
   *
   * A {@link Model3D} labels each node with its name in the file, or `node_<n>` for an unnamed
   * one, where `n` is the node's index in the file.
   * @example
   * ```ts
   * const head = skeleton.indexOf('Head');
   * ```
   * @param label - Node label to look up
   * @returns The node index for `label`
   * @throws {Error} When no node has `label`, or the skeleton was built without `labels`.
   */
  public indexOf(label: string): number {
    const idx = this._labelToIndex[label];
    if (idx === undefined) throw new Error(`Unknown bone label: ${label}`);
    return idx;
  }

  /**
   * Sets a node's local position, rotation and scale, and marks the skeleton dirty
   *
   * Scale defaults to 1 on each axis, so leaving it out resets any scale the node had. The
   * rotation is used as given, without normalizing, so pass a unit quaternion.
   * @example
   * ```ts
   * const tip = tail.indexOf('tip');
   *
   * tail.setLocalTRS(tip, 0, 1, 0, 0, 0, Math.sin(bend / 2), Math.cos(bend / 2));
   * ```
   * @param i - Node index; {@link Skeleton#indexOf | indexOf} finds it from a label
   * @param tx - Translation X
   * @param ty - Translation Y
   * @param tz - Translation Z
   * @param qx - Rotation quaternion X
   * @param qy - Rotation quaternion Y
   * @param qz - Rotation quaternion Z
   * @param qw - Rotation quaternion W
   * @param sx - Scale X
   * @param sy - Scale Y
   * @param sz - Scale Z
   */
  public setLocalTRS(
    i: number,
    tx: number,
    ty: number,
    tz: number,
    qx: number,
    qy: number,
    qz: number,
    qw: number,
    sx = 1,
    sy = 1,
    sz = 1,
  ): void {
    const p = i * 3;
    this.localPosition[p + 0] = tx;
    this.localPosition[p + 1] = ty;
    this.localPosition[p + 2] = tz;

    const r = i * 4;
    this.localRotation[r + 0] = qx;
    this.localRotation[r + 1] = qy;
    this.localRotation[r + 2] = qz;
    this.localRotation[r + 3] = qw;

    const s = i * 3;
    this.localScale[s + 0] = sx;
    this.localScale[s + 1] = sy;
    this.localScale[s + 2] = sz;

    this.dirty = true;
  }

  /**
   * Recomputes {@link Skeleton#worldMatrix | worldMatrix} from the local pose, if the skeleton is
   * dirty
   *
   * The view calls it every frame for each skeleton it draws, so call it yourself only to read
   * `worldMatrix` before the next render. Bones bound with
   * {@link Skeleton#bindContainerBone | bindContainerBone} copy their containers' transforms
   * first, which can make the skeleton dirty.
   *
   * One pass over the nodes builds each node's matrix from its parent's, which is why a parent
   * must come before its children. The multiply that applies a joint's inverse bind reads only the
   * top three rows of each matrix, so an inverse bind whose bottom row isn't `0, 0, 0, 1`, which
   * glTF forbids, can't distort the skin.
   * @advanced
   */
  public updateWorld(): void {
    if (this._containerBones.length !== 0) this._syncContainerBones();

    if (!this.dirty) return;

    for (let i = 0; i < this.nodeCount; i++) {
      const parentIndex = this.parent[i];

      this._writeTRSToMat4(i, this._nodeWorldMatrix);

      if (parentIndex >= 0) {
        Matrix4.multiplyAffine(
          this._nodeWorldMatrix,
          i * 16,
          this._nodeWorldMatrix,
          parentIndex * 16,
          this._nodeWorldMatrix,
          i * 16,
        );
      }
    }

    for (let j = 0; j < this.jointCount; j++) {
      const nodeIndex = this.joints[j];

      Matrix4.multiplyAffineTo3x4(
        this.worldMatrix,
        j * BONE_MATRIX_FLOATS,
        this._nodeWorldMatrix,
        nodeIndex * 16,
        this.inverseBindMatrices,
        j * 16,
      );
    }

    this.dirty = false;
  }

  /**
   * Makes a node follow a scene-graph container's local position, rotation and scale
   *
   * A {@link Model3D} does this for nodes that are both bones and containers: a node above the
   * joints that also holds meshes, which stays in the scene graph. Moving or animating the
   * container then moves the skin. The node keeps following the container until the skeleton is
   * destroyed.
   * @example
   * ```ts
   * skeleton.bindContainerBone(skeleton.indexOf('Armature'), armature);
   * ```
   * @param boneIndex - Index of the node that follows `src`
   * @param src - The container to follow
   * @advanced
   */
  public bindContainerBone(boneIndex: number, src: Container3D): void {
    this._containerBones.push({ boneIndex, src });
  }

  /**
   * Copies each bound container's local TRS into the bone arrays, marking the skeleton dirty only
   * when a value changed
   *
   * The translation comes from the local matrix, so an `origin` reaches the skin. A stale matrix is
   * rebuilt here, since the transform pass skips hidden nodes.
   *
   * The bone arrays hold float32, so the quaternion and scale are compared against their rounded
   * values: a float64 such as 0.1 never equals its stored copy, which would rebuild a still
   * skeleton every frame. The matrix translation is float32 already.
   *
   * {@link Skeleton#updateWorld} checks for bound containers before calling this, because it is
   * too large for V8 to inline and even an empty call costs.
   */
  private _syncContainerBones(): void {
    const bones = this._containerBones;

    for (let k = 0; k < bones.length; k++) {
      const { boneIndex, src } = bones[k];

      if (src._localTransformDirty) {
        src.updateLocalTransform();
        src._localTransformDirty = false;
      }

      const t = src.localTransform.elements;
      const q = src.quaternion;
      const s = src.scale;
      const pi = boneIndex * 3;
      const ri = boneIndex * 4;
      const lp = this.localPosition;
      const lr = this.localRotation;
      const ls = this.localScale;

      if (
        lp[pi] !== t[12] ||
        lp[pi + 1] !== t[13] ||
        lp[pi + 2] !== t[14] ||
        lr[ri] !== Math.fround(q.x) ||
        lr[ri + 1] !== Math.fround(q.y) ||
        lr[ri + 2] !== Math.fround(q.z) ||
        lr[ri + 3] !== Math.fround(q.w) ||
        ls[pi] !== Math.fround(s.x) ||
        ls[pi + 1] !== Math.fround(s.y) ||
        ls[pi + 2] !== Math.fround(s.z)
      ) {
        lp[pi] = t[12];
        lp[pi + 1] = t[13];
        lp[pi + 2] = t[14];
        lr[ri] = q.x;
        lr[ri + 1] = q.y;
        lr[ri + 2] = q.z;
        lr[ri + 3] = q.w;
        ls[pi] = s.x;
        ls[pi + 1] = s.y;
        ls[pi + 2] = s.z;
        this.dirty = true;
      }
    }
  }

  /**
   * Stops the nodes following their containers, without destroying the containers
   *
   * The bind data ({@link Skeleton#inverseBindMatrices | inverseBindMatrices},
   * {@link Skeleton#parent | parent} and {@link Skeleton#joints | joints}) belongs to the source the
   * skeleton came from and stays. A {@link Model3D} destroys its own skeletons. Calling it again
   * does nothing.
   * @example
   * ```ts
   * tailMesh.destroy();
   * tail.destroy();
   * ```
   */
  public destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    this._containerBones.length = 0;

    this._bonePitIndex = -1;
    this._bonePitTick = -1;
  }

  /**
   * Builds node `i`'s local matrix from its TRS into `outMat` at offset `i * 16`, expanding the
   * quaternion inline so no intermediate matrix is made
   * @param i - Node index
   * @param outMat - Receives the matrix at offset `i * 16`
   * @internal
   */
  private _writeTRSToMat4(i: number, outMat: Float32Array): void {
    const p = i * 3;
    const r = i * 4;
    const s = i * 3;
    const m = i * 16;

    const tx = this.localPosition[p + 0];
    const ty = this.localPosition[p + 1];
    const tz = this.localPosition[p + 2];

    const x = this.localRotation[r + 0];
    const y = this.localRotation[r + 1];
    const z = this.localRotation[r + 2];
    const w = this.localRotation[r + 3];

    const sx = this.localScale[s + 0];
    const sy = this.localScale[s + 1];
    const sz = this.localScale[s + 2];

    const x2 = x + x;
    const y2 = y + y;
    const z2 = z + z;

    const xx = x * x2;
    const xy = x * y2;
    const xz = x * z2;
    const yy = y * y2;
    const yz = y * z2;
    const zz = z * z2;
    const wx = w * x2;
    const wy = w * y2;
    const wz = w * z2;

    outMat[m + 0] = (1 - (yy + zz)) * sx;
    outMat[m + 1] = (xy + wz) * sx;
    outMat[m + 2] = (xz - wy) * sx;
    outMat[m + 3] = 0;

    outMat[m + 4] = (xy - wz) * sy;
    outMat[m + 5] = (1 - (xx + zz)) * sy;
    outMat[m + 6] = (yz + wx) * sy;
    outMat[m + 7] = 0;

    outMat[m + 8] = (xz + wy) * sz;
    outMat[m + 9] = (yz - wx) * sz;
    outMat[m + 10] = (1 - (xx + yy)) * sz;
    outMat[m + 11] = 0;

    outMat[m + 12] = tx;
    outMat[m + 13] = ty;
    outMat[m + 14] = tz;
    outMat[m + 15] = 1;
  }
}
