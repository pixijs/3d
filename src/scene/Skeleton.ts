import { definedProps } from 'pixi.js';

import { BONE_MATRIX_FLOATS } from '../core/buffers/BonePit';
import { Matrix4 } from '../math/matrix/Matrix4';
import type { Container3D } from './Container3D';

/**
 * Constructor options for {@link Skeleton}
 *
 * The first three fields are structural (no meaningful default) and must be supplied; `labels`
 * is optional and falls back to {@link Skeleton.defaultOptions}.
 *
 * Normally produced by the `Model3D` constructor from a parsed glTF skin — application
 * code rarely constructs `SkeletonOptions` directly.
 * @category scene
 * @standard
 */
export interface SkeletonOptions {
  /** Parent-index per node (`-1` for roots); length determines `nodeCount` */
  parent: Int16Array;
  /** Node indices that are skinning joints; length determines `jointCount` */
  joints: Int16Array;
  /** Packed `mat4` inverse-bind matrices, one per joint (length = `16 * jointCount`) */
  inverseBindMatrices: Float32Array;
  /** Optional node labels, indexed by node index, for {@link Skeleton.indexOf} lookups and debugging */
  labels?: string[];
}

/**
 * A `Skeleton` is the rigging data for a skinned {@link Mesh3D}
 *
 * It holds the joint hierarchy, the per-frame pose (local TRS per node), the resulting
 * per-joint world matrices uploaded to the GPU, and the inverse-bind
 * matrices used to skin vertices from bind-pose to current pose.
 *
 * Skeletons are owned by a {@link Model3D} (typically built by
 * the `Model3D` constructor from a glTF skin) and referenced from one or more
 * {@link Mesh3D} via `mesh.skeleton`. Each frame the View's skinning pass
 * calls {@link Skeleton.updateWorld} on dirty skeletons, which rebuilds
 * world matrices from the local TRS arrays and uploads them through
 * `BonePit` into the global bone-matrix arena.
 *
 * Packed TRS layout (authoritative pose state, all node-indexed):
 * - {@link Skeleton.localPosition} — 3 floats per node (`tx, ty, tz`)
 * - {@link Skeleton.localRotation} — 4 floats per node (quaternion `x, y, z, w`)
 * - {@link Skeleton.localScale}    — 3 floats per node (`sx, sy, sz`, default 1)
 *
 * Output matrices:
 * - {@link Skeleton.worldMatrix}        — `BONE_MATRIX_FLOATS` floats per **joint**, three rows
 *   of four. Copied into the `BonePit` by whichever View3D renders this skeleton; the
 *   skeleton itself owns no GPU resource.
 * - {@link Skeleton.inverseBindMatrices} — 16 floats per joint, column-major (immutable, from
 *   bind pose)
 *
 * Mutating any pose value must set {@link Skeleton.dirty} so the next
 * skinning pass picks up the change; the helper {@link Skeleton.setLocalTRS}
 * does this for you.
 * @example
 * ```ts
 * // Skeletons are usually built for you:
 * const scene = new Model3D(gltfSource);
 * const skeleton = scene.skeletons[0];
 *
 * // Pose a bone (rotate joint "spine" 30 degrees around Y):
 * const i = skeleton.indexOf('spine');
 * const half = Math.PI / 12;
 * skeleton.setLocalTRS(i, 0, 0, 0, 0, Math.sin(half), 0, Math.cos(half));
 *
 * // Manual updateWorld is only needed if you bypass the View's skinning pass:
 * skeleton.updateWorld();
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
   * `new Skeleton(opts)` resolves as `{ ...Skeleton.defaultOptions, ...opts }`.
   *
   * The structural fields (`parent`, `joints`, `inverseBindMatrices`) have
   * no meaningful default and must always be supplied per instance, so this
   * starts empty; override here to change the default `labels` process-wide.
   */
  public static defaultOptions: Partial<SkeletonOptions> = {};

  /** Total number of nodes in the hierarchy (joints + intermediate nodes) */
  public readonly nodeCount: number;
  /** Number of skinning joints (a subset of nodes) */
  public readonly jointCount: number;

  /** Parent-index per node (`-1` for roots); length is `nodeCount` */
  public readonly parent: Int16Array;
  /** Node indices that are skinning joints; length is `jointCount` */
  public readonly joints: Int16Array;

  /**
   * Inverse-bind matrices for skinning, one packed `mat4` per joint (length `16 * jointCount`)
   *
   * Captured at bind time and immutable thereafter.
   */
  public readonly inverseBindMatrices: Float32Array;

  /** Local-pose translation per node: 3 floats (`tx, ty, tz`) × `nodeCount` */
  public readonly localPosition: Float32Array;
  /** Local-pose rotation per node: 4-float quaternion (`x, y, z, w`) × `nodeCount` */
  public readonly localRotation: Float32Array;
  /** Local-pose scale per node: 3 floats (`sx, sy, sz`) × `nodeCount`; defaults to 1 */
  public readonly localScale: Float32Array;

  /**
   * Skinning matrices for JOINTS only — `12 * jointCount` floats, three rows of four per joint
   *
   * Each entry is the joint's world matrix times its inverse bind, row-major:
   * `[m00 m01 m02 m03][m10 m11 m12 m13][m20 m21 m22 m23]`. The affine fourth row `(0, 0, 0, 1)`
   * isn't stored. This is the buffer uploaded to the GPU each frame.
   */
  public readonly worldMatrix: Float32Array;

  /**
   * Set to `true` when any local TRS has been mutated since the last {@link Skeleton.updateWorld}
   *
   * Public update protocol: callers that write directly into the TRS arrays must set this flag
   * themselves; {@link Skeleton.setLocalTRS} sets it for you. `updateWorld` clears it.
   */
  public dirty = true;

  /**
   * Index of this skeleton's slot within the View's `BonePit`. `-1` until assigned
   * @internal
   */
  public _bonePitIndex = -1;
  /**
   * Last-seen `BonePit` tick — used to detect arena reallocations
   * @internal
   */
  public _bonePitTick = -1;

  /**
   * Re-entry guard for {@link Skeleton.destroy}; prevents double-freeing the GPU buffer
   * @internal
   */
  private _destroyed = false;

  /**
   * Lookup table from node label to node index, built when `labels` was supplied
   * @internal
   */
  private readonly _labelToIndex!: Record<string, number>;
  /**
   * World matrices for ALL nodes (`16 * nodeCount` floats). Used
   * as the scratch surface for the hierarchy walk in {@link Skeleton.updateWorld};
   * the public {@link Skeleton.worldMatrix} extracts only joint slots from it.
   * @internal
   */
  private readonly _nodeWorldMatrix: Float32Array;

  /**
   * Bones that mirror a kept scene-graph container. When a skin omits glTF
   * `skeleton`, the collected skeleton includes shared ancestor nodes that also
   * anchor visible geometry; those stay in the scene graph and may be animated
   * there, so each such bone re-reads its container's local TRS before the world
   * sweep (see {@link Skeleton.updateWorld}). Empty for the common case (bounded
   * skeletons), so it costs nothing then.
   * @internal
   */
  private readonly _containerBones: { boneIndex: number; src: Container3D }[] = [];

  /**
   * Constructs a new `Skeleton`
   *
   * Normally called by the `Model3D` constructor; application code rarely instantiates skeletons directly.
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

    // Identity pose: quat w = 1, scale = 1, world matrices identity.
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
   * Resolves a node label to its node index
   *
   * Requires that `labels` was supplied at construction time.
   * @param label - Node label to look up
   * @returns The node index for `label`
   * @throws {Error} When `label` is not in the label table.
   */
  public indexOf(label: string): number {
    const idx = this._labelToIndex[label];
    if (idx === undefined) throw new Error(`Unknown bone label: ${label}`);
    return idx;
  }

  /**
   * Writes a full local TRS pose for node `i` and marks the skeleton dirty
   *
   * Scale defaults to `1` per axis when omitted. The quaternion is taken as-is
   * (no normalisation) — pass a unit quaternion.
   * @param i - Node index (use {@link Skeleton.indexOf} to resolve from a label)
   * @param tx - Translation X
   * @param ty - Translation Y
   * @param tz - Translation Z
   * @param qx - Rotation quaternion X
   * @param qy - Rotation quaternion Y
   * @param qz - Rotation quaternion Z
   * @param qw - Rotation quaternion W
   * @param sx - Scale X (default `1`)
   * @param sy - Scale Y (default `1`)
   * @param sz - Scale Z (default `1`)
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
   * Rebuilds world matrices from the local TRS arrays and uploads
   * {@link Skeleton.worldMatrix} to the GPU
   *
   * No-op when `dirty` is false.
   *
   * Assumes `parent` is ordered parent-before-child so a single forward
   * sweep produces correct world matrices. For each joint the GPU-bound
   * matrix is computed as `nodeWorld * inverseBindMatrix`.
   */
  public updateWorld(): void {
    // Guarded here rather than inside: the sync is too large for V8 to inline, so an empty call still costs.
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

      // Joint matrix = nodeWorld * inverseBindMatrix, stored as three rows of four.
      // The multiply reads only the twelve informative lanes of each operand, so a
      // non-affine inverse bind from a malformed asset is neutralised here.
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
   * Binds bone `boneIndex` to a scene-graph container so the bone tracks the
   * container's (possibly animated) local transform
   *
   * Called by the `Model3D` constructor for shared ancestor nodes kept in both the scene graph and
   * the skeleton.
   * @param boneIndex - Local skeleton node index to drive from `src`
   * @param src - The container whose local TRS this bone mirrors
   */
  public bindContainerBone(boneIndex: number, src: Container3D): void {
    this._containerBones.push({ boneIndex, src });
  }

  /**
   * Copies each bound container's local TRS into the bone arrays, marking the
   * skeleton dirty only when a value actually changed
   *
   * The translation comes from the local matrix, so an `origin` reaches the skin. A stale matrix is
   * rebuilt here, since the transform pass skips hidden nodes.
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

      // The bone arrays hold float32, so compare the quaternion and scale against their rounded
      // values: a float64 like 0.1 never equals its stored copy, which would rebuild a still skeleton
      // every frame. The matrix translation is float32 already.
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
   * Releases this skeleton's references and its bone-pit reservation
   *
   * Drops the shared container-bone references without destroying them. Shared bind data
   * ({@link Skeleton.inverseBindMatrices}, {@link Skeleton.parent},
   * {@link Skeleton.joints}) originates from the source descriptor and is left
   * intact. Idempotent — a second call is a no-op.
   */
  public destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    this._containerBones.length = 0;

    this._bonePitIndex = -1;
    this._bonePitTick = -1;
  }

  /**
   * Builds a `mat4` from node `i`'s local TRS into `outMat` at
   * offset `i * 16`. Inlines the quat→mat3 expansion to avoid intermediate
   * matrices.
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
