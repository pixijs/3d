import { warn } from 'pixi.js';

import type { Quaternion } from '../rotation/Quaternion';
import type { TypedFixedArray } from '../utils/misc';
import type { PointData3D } from '../vector/PointData3D';
import type { PointLike3D } from '../vector/PointLike3D';
import { Vector3 } from '../vector/Vector3';

/**
 * A 4x4 matrix for 3D transforms and projections
 *
 * {@link Matrix4#elements} holds the sixteen values column by column, the order shaders use, and a
 * `Matrix4` can be the value of a `mat4x4<f32>` uniform as it is. Points are columns, so in `a * b`
 * the matrix `b` applies to a point first: `projection * view * world` takes a point on a model
 * to clip space.
 *
 * Methods that change the matrix do so in place, or write into an `out` matrix when you pass one
 * and leave this matrix as it is.
 * @example
 * ```ts
 * const cameraWorld = new Matrix4().lookAt(eye, target, { x: 0, y: 1, z: 0 }).setPosition(eye);
 * const view = new Matrix4().getInverse(cameraWorld);
 * const projection = new Matrix4().makePerspective(Math.PI / 3, width / height, 0.1, 500);
 * const viewProjection = new Matrix4().multiplyMatrices(projection, view);
 * ```
 * @see {@link Vector3#applyMatrix4} For applying this matrix to a point
 * @category maths
 * @standard
 */
export class Matrix4 {
  /**
   * The sixteen values, column by column: the translation sits at indices 12, 13 and 14
   * @example
   * ```ts
   * const worldHeight = mesh.worldTransform.elements[13];
   * ```
   */
  public elements: TypedFixedArray<16>;

  /**
   * A `Float64Array` over the same memory as {@link Matrix4#elements}, for copying the matrix as
   * eight 64-bit moves instead of sixteen 32-bit ones
   *
   * > [!IMPORTANT] Each entry is two of the matrix's floats read as one 64-bit number, which means
   * > nothing on its own. Use it only to copy into another `Float64Array` view of float data.
   * @example
   * ```ts
   * const instanceData = new Float32Array(instanceCount * 16);
   * const instanceData64 = new Float64Array(instanceData.buffer);
   *
   * instanceData64.set(mesh.worldTransform.elements64, index * 8);
   * ```
   * @advanced
   */
  public elements64: Float64Array;

  /**
   * The array {@link Matrix4#toArray} writes into when given no `out`; `null` until its first call
   * @example
   * ```ts
   * worldMatrix.toArray(true);
   * const rowMajor = worldMatrix.array!;
   * ```
   * @default null
   * @advanced
   */
  public array: Float32Array | null = null;

  /**
   * Multiplies two affine matrices, `out = a * b`, and writes the result as three rows of four
   *
   * The rows land as `[m00 m01 m02 m03][m10 m11 m12 m13][m20 m21 m22 m23]`, translation last in
   * each, so a shader can read them as three `vec4`s and transform a point with three dot products.
   * The bottom rows of `a` and `b` are never read.
   * @example
   * ```ts
   * const boneRows = new Float32Array(boneCount * 12);
   *
   * for (let i = 0; i < boneCount; i++) {
   *   Matrix4.multiplyAffineTo3x4(boneRows, i * 12, boneWorlds, i * 16, inverseBinds, i * 16);
   * }
   * ```
   * @param out - Destination, 12 floats per entry.
   * @param outOffset - Float offset of the destination entry.
   * @param a - Left operand, 16 floats per entry (column-major).
   * @param aOffset - Float offset of the left entry.
   * @param b - Right operand, 16 floats per entry (column-major).
   * @param bOffset - Float offset of the right entry.
   * @advanced
   */
  public static multiplyAffineTo3x4(
    out: Float32Array,
    outOffset: number,
    a: Float32Array,
    aOffset: number,
    b: Float32Array,
    bOffset: number,
  ): void {
    const a00 = a[aOffset + 0];
    const a01 = a[aOffset + 1];
    const a02 = a[aOffset + 2];
    const a10 = a[aOffset + 4];
    const a11 = a[aOffset + 5];
    const a12 = a[aOffset + 6];
    const a20 = a[aOffset + 8];
    const a21 = a[aOffset + 9];
    const a22 = a[aOffset + 10];
    const a30 = a[aOffset + 12];
    const a31 = a[aOffset + 13];
    const a32 = a[aOffset + 14];

    const b00 = b[bOffset + 0];
    const b01 = b[bOffset + 1];
    const b02 = b[bOffset + 2];
    const b10 = b[bOffset + 4];
    const b11 = b[bOffset + 5];
    const b12 = b[bOffset + 6];
    const b20 = b[bOffset + 8];
    const b21 = b[bOffset + 9];
    const b22 = b[bOffset + 10];
    const b30 = b[bOffset + 12];
    const b31 = b[bOffset + 13];
    const b32 = b[bOffset + 14];

    out[outOffset + 0] = a00 * b00 + a10 * b01 + a20 * b02;
    out[outOffset + 1] = a00 * b10 + a10 * b11 + a20 * b12;
    out[outOffset + 2] = a00 * b20 + a10 * b21 + a20 * b22;
    out[outOffset + 3] = a00 * b30 + a10 * b31 + a20 * b32 + a30;

    out[outOffset + 4] = a01 * b00 + a11 * b01 + a21 * b02;
    out[outOffset + 5] = a01 * b10 + a11 * b11 + a21 * b12;
    out[outOffset + 6] = a01 * b20 + a11 * b21 + a21 * b22;
    out[outOffset + 7] = a01 * b30 + a11 * b31 + a21 * b32 + a31;

    out[outOffset + 8] = a02 * b00 + a12 * b01 + a22 * b02;
    out[outOffset + 9] = a02 * b10 + a12 * b11 + a22 * b12;
    out[outOffset + 10] = a02 * b20 + a12 * b21 + a22 * b22;
    out[outOffset + 11] = a02 * b30 + a12 * b31 + a22 * b32 + a32;
  }

  /**
   * Multiplies two affine matrices held in flat arrays, `out = a * b`, skipping the bottom row
   *
   * Reads only the top three rows of `a` and `b` and writes `0, 0, 0, 1` as the bottom row, so it
   * does 36 multiplies where a full 4x4 product does 64. `out` may be the same array as `a` or `b`.
   * @example
   * ```ts
   * for (let i = 0; i < nodeCount; i++) {
   *   Matrix4.multiplyAffine(worlds, i * 16, worlds, parentIndices[i] * 16, locals, i * 16);
   * }
   * ```
   * @param out - Buffer receiving the product
   * @param outOffset - Index of the product's first element in `out`
   * @param a - Buffer holding the left operand
   * @param aOffset - Index of the left operand's first element in `a`
   * @param b - Buffer holding the right operand
   * @param bOffset - Index of the right operand's first element in `b`
   * @advanced
   */
  public static multiplyAffine(
    out: Float32Array,
    outOffset: number,
    a: Float32Array,
    aOffset: number,
    b: Float32Array,
    bOffset: number,
  ): void {
    const a00 = a[aOffset + 0];
    const a01 = a[aOffset + 1];
    const a02 = a[aOffset + 2];
    const a10 = a[aOffset + 4];
    const a11 = a[aOffset + 5];
    const a12 = a[aOffset + 6];
    const a20 = a[aOffset + 8];
    const a21 = a[aOffset + 9];
    const a22 = a[aOffset + 10];
    const a30 = a[aOffset + 12];
    const a31 = a[aOffset + 13];
    const a32 = a[aOffset + 14];

    const b00 = b[bOffset + 0];
    const b01 = b[bOffset + 1];
    const b02 = b[bOffset + 2];
    const b10 = b[bOffset + 4];
    const b11 = b[bOffset + 5];
    const b12 = b[bOffset + 6];
    const b20 = b[bOffset + 8];
    const b21 = b[bOffset + 9];
    const b22 = b[bOffset + 10];
    const b30 = b[bOffset + 12];
    const b31 = b[bOffset + 13];
    const b32 = b[bOffset + 14];

    out[outOffset + 0] = a00 * b00 + a10 * b01 + a20 * b02;
    out[outOffset + 1] = a01 * b00 + a11 * b01 + a21 * b02;
    out[outOffset + 2] = a02 * b00 + a12 * b01 + a22 * b02;
    out[outOffset + 3] = 0;

    out[outOffset + 4] = a00 * b10 + a10 * b11 + a20 * b12;
    out[outOffset + 5] = a01 * b10 + a11 * b11 + a21 * b12;
    out[outOffset + 6] = a02 * b10 + a12 * b11 + a22 * b12;
    out[outOffset + 7] = 0;

    out[outOffset + 8] = a00 * b20 + a10 * b21 + a20 * b22;
    out[outOffset + 9] = a01 * b20 + a11 * b21 + a21 * b22;
    out[outOffset + 10] = a02 * b20 + a12 * b21 + a22 * b22;
    out[outOffset + 11] = 0;

    out[outOffset + 12] = a00 * b30 + a10 * b31 + a20 * b32 + a30;
    out[outOffset + 13] = a01 * b30 + a11 * b31 + a21 * b32 + a31;
    out[outOffset + 14] = a02 * b30 + a12 * b31 + a22 * b32 + a32;
    out[outOffset + 15] = 1;
  }

  /**
   * A shared `Matrix4`, reset to identity on every access, for a one-off calculation
   *
   * > [!IMPORTANT] This matrix is shared and temporary. Do not store references to it.
   * @example
   * ```ts
   * localHit.copyFrom(worldHit).applyMatrix4(Matrix4.shared.getInverse(mesh.worldTransform));
   * ```
   */
  static get shared(): Matrix4 {
    return _sharedMatrix.identity();
  }

  /**
   * A read-only identity matrix
   *
   * > [!IMPORTANT] This is a shared instance; do not mutate it. Use {@link Matrix4.shared} when you
   * > need a writable temporary.
   * @example
   * ```ts
   * const atRest = bone.localTransform.equals(Matrix4.IDENTITY);
   * ```
   */
  static get IDENTITY(): Readonly<Matrix4> {
    return _identityMatrix.identity();
  }

  /**
   * Creates a new `Matrix4`, defaulting to the identity matrix
   * @param elements - Optional column-major `Float32Array` of 16 floats, used as is rather than
   *   copied. Its byte offset must be a multiple of 8, or this throws, since
   *   {@link Matrix4#elements64} views the same memory.
   */
  constructor(elements?: TypedFixedArray<16>) {
    this.elements =
      elements || (new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) as TypedFixedArray<16>);

    const f32 = this.elements;
    this.elements64 = new Float64Array(f32.buffer, f32.byteOffset, 8);
  }

  /**
   * Sets the 16 elements from arguments given row by row, as the matrix is written on paper
   * @example
   * ```ts
   * const shearX = new Matrix4().set(
   *   1, 0.5, 0, 0,
   *   0, 1, 0, 0,
   *   0, 0, 1, 0,
   *   0, 0, 0, 1,
   * );
   * ```
   * @param n11 - Row 1, column 1
   * @param n12 - Row 1, column 2
   * @param n13 - Row 1, column 3
   * @param n14 - Row 1, column 4
   * @param n21 - Row 2, column 1
   * @param n22 - Row 2, column 2
   * @param n23 - Row 2, column 3
   * @param n24 - Row 2, column 4
   * @param n31 - Row 3, column 1
   * @param n32 - Row 3, column 2
   * @param n33 - Row 3, column 3
   * @param n34 - Row 3, column 4
   * @param n41 - Row 4, column 1
   * @param n42 - Row 4, column 2
   * @param n43 - Row 4, column 3
   * @param n44 - Row 4, column 4
   * @returns This matrix
   */
  public set(
    n11: number,
    n12: number,
    n13: number,
    n14: number,
    n21: number,
    n22: number,
    n23: number,
    n24: number,
    n31: number,
    n32: number,
    n33: number,
    n34: number,
    n41: number,
    n42: number,
    n43: number,
    n44: number,
  ): this {
    const te = this.elements;

    te[0] = n11;
    te[1] = n21;
    te[2] = n31;
    te[3] = n41;
    te[4] = n12;
    te[5] = n22;
    te[6] = n32;
    te[7] = n42;
    te[8] = n13;
    te[9] = n23;
    te[10] = n33;
    te[11] = n43;
    te[12] = n14;
    te[13] = n24;
    te[14] = n34;
    te[15] = n44;

    return this;
  }

  /**
   * Resets this matrix to the identity matrix
   * @example
   * ```ts
   * transform.identity().setPosition(spawnPoint);
   * ```
   * @returns This matrix
   */
  public identity(): this {
    return this.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  }

  /**
   * Checks whether this matrix equals the identity matrix exactly
   * @example
   * ```ts
   * const untouched = node.localTransform.isIdentity();
   * ```
   * @returns True when every element matches the identity matrix
   */
  public isIdentity(): boolean {
    const e = this.elements;

    return (
      e[0] === 1 &&
      e[1] === 0 &&
      e[2] === 0 &&
      e[3] === 0 &&
      e[4] === 0 &&
      e[5] === 1 &&
      e[6] === 0 &&
      e[7] === 0 &&
      e[8] === 0 &&
      e[9] === 0 &&
      e[10] === 1 &&
      e[11] === 0 &&
      e[12] === 0 &&
      e[13] === 0 &&
      e[14] === 0 &&
      e[15] === 1
    );
  }

  /**
   * Copies the elements of `m` into this matrix
   * @example
   * ```ts
   * previousWorld.copyFrom(mesh.worldTransform);
   * ```
   * @param m - Matrix to copy from
   * @returns This matrix
   */
  public copyFrom(m: Matrix4): this {
    const te = this.elements;
    const me = m.elements;

    te[0] = me[0];
    te[1] = me[1];
    te[2] = me[2];
    te[3] = me[3];
    te[4] = me[4];
    te[5] = me[5];
    te[6] = me[6];
    te[7] = me[7];
    te[8] = me[8];
    te[9] = me[9];
    te[10] = me[10];
    te[11] = me[11];
    te[12] = me[12];
    te[13] = me[13];
    te[14] = me[14];
    te[15] = me[15];

    return this;
  }

  /**
   * Copies this matrix's elements into `target`
   * @example
   * ```ts
   * mesh.worldTransform.copyTo(previousWorld);
   * ```
   * @param target - Matrix to copy into
   * @returns The given target matrix
   */
  public copyTo<T extends Matrix4>(target: T): T {
    const te = target.elements;
    const me = this.elements;

    te[0] = me[0];
    te[1] = me[1];
    te[2] = me[2];
    te[3] = me[3];
    te[4] = me[4];
    te[5] = me[5];
    te[6] = me[6];
    te[7] = me[7];
    te[8] = me[8];
    te[9] = me[9];
    te[10] = me[10];
    te[11] = me[11];
    te[12] = me[12];
    te[13] = me[13];
    te[14] = me[14];
    te[15] = me[15];

    return target;
  }

  /**
   * Checks whether all 16 elements of this matrix match `m` exactly, with no tolerance
   * @example
   * ```ts
   * const moved = !mesh.worldTransform.equals(previousWorld);
   * ```
   * @param m - Matrix to compare against
   * @returns True when every element matches
   */
  public equals(m: Matrix4): boolean {
    const te = this.elements;
    const me = m.elements;

    return (
      te[0] === me[0] &&
      te[1] === me[1] &&
      te[2] === me[2] &&
      te[3] === me[3] &&
      te[4] === me[4] &&
      te[5] === me[5] &&
      te[6] === me[6] &&
      te[7] === me[7] &&
      te[8] === me[8] &&
      te[9] === me[9] &&
      te[10] === me[10] &&
      te[11] === me[11] &&
      te[12] === me[12] &&
      te[13] === me[13] &&
      te[14] === me[14] &&
      te[15] === me[15]
    );
  }

  /**
   * Creates a new `Matrix4` with the same elements
   * @example
   * ```ts
   * const restPose = bone.localTransform.clone();
   * ```
   * @returns The new matrix
   */
  public clone(): Matrix4 {
    return new Matrix4().copyFrom(this);
  }

  /**
   * Formats this matrix as a readable row-by-row string
   * @returns The string representation
   * @advanced
   */
  public toString(): string {
    const e = this.elements;

    return `[@pixi/3d/math:Matrix4 [${e[0]}, ${e[4]}, ${e[8]}, ${e[12]} | ${e[1]}, ${e[5]}, ${e[9]}, ${e[13]} | ${e[2]}, ${e[6]}, ${e[10]}, ${e[14]} | ${e[3]}, ${e[7]}, ${e[11]}, ${e[15]}]]`;
  }

  /**
   * Reads the 16 elements from `array` (column-major) starting at `offset`
   * @example
   * ```ts
   * const instanceMatrix = new Matrix4().fromArray(instanceData, index * 16);
   * ```
   * @param array - Source array of column-major elements
   * @param offset - Index of the first element to read
   * @returns This matrix
   */
  public fromArray(array: ArrayLike<number>, offset = 0): this {
    const e = this.elements;

    e[0] = array[offset];
    e[1] = array[offset + 1];
    e[2] = array[offset + 2];
    e[3] = array[offset + 3];
    e[4] = array[offset + 4];
    e[5] = array[offset + 5];
    e[6] = array[offset + 6];
    e[7] = array[offset + 7];
    e[8] = array[offset + 8];
    e[9] = array[offset + 9];
    e[10] = array[offset + 10];
    e[11] = array[offset + 11];
    e[12] = array[offset + 12];
    e[13] = array[offset + 13];
    e[14] = array[offset + 14];
    e[15] = array[offset + 15];

    return this;
  }

  /**
   * Writes this matrix's elements into a Float32Array
   *
   * Without `out`, writes into and returns {@link Matrix4#array}.
   * @example
   * ```ts
   * const rowMajor = new Float32Array(16);
   *
   * mesh.worldTransform.toArray(true, rowMajor);
   * ```
   * @param transpose - `true` writes row-major instead of column-major
   * @param out - Optional destination array
   * @returns The populated array
   */
  public toArray(transpose?: boolean, out?: Float32Array): Float32Array {
    if (!this.array) this.array = new Float32Array(16);
    const arr = out || this.array;
    const e = this.elements;

    if (transpose) {
      arr[0] = e[0];
      arr[1] = e[4];
      arr[2] = e[8];
      arr[3] = e[12];
      arr[4] = e[1];
      arr[5] = e[5];
      arr[6] = e[9];
      arr[7] = e[13];
      arr[8] = e[2];
      arr[9] = e[6];
      arr[10] = e[10];
      arr[11] = e[14];
      arr[12] = e[3];
      arr[13] = e[7];
      arr[14] = e[11];
      arr[15] = e[15];
    } else {
      arr[0] = e[0];
      arr[1] = e[1];
      arr[2] = e[2];
      arr[3] = e[3];
      arr[4] = e[4];
      arr[5] = e[5];
      arr[6] = e[6];
      arr[7] = e[7];
      arr[8] = e[8];
      arr[9] = e[9];
      arr[10] = e[10];
      arr[11] = e[11];
      arr[12] = e[12];
      arr[13] = e[13];
      arr[14] = e[14];
      arr[15] = e[15];
    }

    return arr;
  }

  /**
   * Multiplies this matrix by `m`: `this = this * m`, so `m` applies to a point first
   * @example
   * ```ts
   * const muzzleWorld = new Matrix4();
   *
   * gun.worldTransform.multiply(muzzleOffset, muzzleWorld);
   * ```
   * @param m - Matrix to multiply by
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public multiply(m: Matrix4, out: Matrix4 = this): this {
    _multiplyMatrices(this, m, out);

    return out as this;
  }

  /**
   * Pre-multiplies this matrix by `m`: `this = m * this`, so `m` applies to a point last
   * @example
   * ```ts
   * const spin = new Matrix4().makeRotationY(0.01);
   *
   * app.ticker.add(() => orbit.premultiply(spin));
   * ```
   * @param m - Matrix to pre-multiply by
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public premultiply(m: Matrix4, out: Matrix4 = this): this {
    _multiplyMatrices(m, this, out);

    return out as this;
  }

  /**
   * Sets this matrix to `a * b`, so `b` applies to a point first
   * @example
   * ```ts
   * const toClip = new Matrix4().multiplyMatrices(camera.viewProjection, mesh.worldTransform);
   * ```
   * @param a - Left operand
   * @param b - Right operand
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public multiplyMatrices(a: Matrix4, b: Matrix4, out: Matrix4 = this): this {
    _multiplyMatrices(a, b, out);

    return out as this;
  }

  /**
   * Multiplies every element of this matrix by the scalar `s`
   * @param s - Scalar to multiply by
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   * @advanced
   */
  public multiplyScalar(s: number, out: Matrix4 = this): this {
    const te = out.elements;
    const se = this.elements;

    te[0] = se[0] * s;
    te[4] = se[4] * s;
    te[8] = se[8] * s;
    te[12] = se[12] * s;
    te[1] = se[1] * s;
    te[5] = se[5] * s;
    te[9] = se[9] * s;
    te[13] = se[13] * s;
    te[2] = se[2] * s;
    te[6] = se[6] * s;
    te[10] = se[10] * s;
    te[14] = se[14] * s;
    te[3] = se[3] * s;
    te[7] = se[7] * s;
    te[11] = se[11] * s;
    te[15] = se[15] * s;

    return out as this;
  }

  /**
   * Pixi-style alias for {@link Matrix4#multiply}: `this = this * m`
   * @example
   * ```ts
   * gun.worldTransform.append(muzzleOffset, muzzleWorld);
   * ```
   * @param m - Matrix to append
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public append(m: Matrix4, out: Matrix4 = this): this {
    return this.multiply(m, out);
  }

  /**
   * Pixi-style alias for {@link Matrix4#premultiply}: `this = m * this`
   * @example
   * ```ts
   * orbit.prepend(spin);
   * ```
   * @param m - Matrix to prepend
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public prepend(m: Matrix4, out: Matrix4 = this): this {
    return this.premultiply(m, out);
  }

  /**
   * Alias for {@link Matrix4#multiplyMatrices}: this matrix becomes `a * b`
   * @example
   * ```ts
   * viewProjection.appendFrom(camera.projection, camera.view);
   * ```
   * @param a - Left operand
   * @param b - Right operand
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public appendFrom(a: Matrix4, b: Matrix4, out: Matrix4 = this): this {
    return this.multiplyMatrices(a, b, out);
  }

  /**
   * Computes the determinant of this matrix
   *
   * Negative when the transform mirrors, as a negative scale does, and 0 when it flattens a
   * dimension and can't be inverted.
   * @example
   * ```ts
   * const mirrored = mesh.worldTransform.determinant() < 0;
   * ```
   * @returns The determinant
   */
  public determinant(): number {
    const te = this.elements;

    const n11 = te[0];
    const n12 = te[4];
    const n13 = te[8];
    const n14 = te[12];
    const n21 = te[1];
    const n22 = te[5];
    const n23 = te[9];
    const n24 = te[13];
    const n31 = te[2];
    const n32 = te[6];
    const n33 = te[10];
    const n34 = te[14];
    const n41 = te[3];
    const n42 = te[7];
    const n43 = te[11];
    const n44 = te[15];

    return (
      n41 *
        (n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34) +
      n42 *
        (n11 * n23 * n34 - n11 * n24 * n33 + n14 * n21 * n33 - n13 * n21 * n34 + n13 * n24 * n31 - n14 * n23 * n31) +
      n43 *
        (n11 * n24 * n32 - n11 * n22 * n34 - n14 * n21 * n32 + n12 * n21 * n34 + n14 * n22 * n31 - n12 * n24 * n31) +
      n44 * (-n13 * n22 * n31 - n11 * n23 * n32 + n11 * n22 * n33 + n13 * n21 * n32 - n12 * n21 * n33 + n12 * n23 * n31)
    );
  }

  /**
   * Transposes this matrix
   * @example
   * ```ts
   * const normalMatrix = new Matrix4().getInverse(mesh.worldTransform).transpose();
   * ```
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public transpose(out: Matrix4 = this): this {
    const me = this.elements;
    const te = out.elements;

    const m0 = me[0];
    const m1 = me[1];
    const m2 = me[2];
    const m3 = me[3];
    const m4 = me[4];
    const m5 = me[5];
    const m6 = me[6];
    const m7 = me[7];
    const m8 = me[8];
    const m9 = me[9];
    const m10 = me[10];
    const m11 = me[11];
    const m12 = me[12];
    const m13 = me[13];
    const m14 = me[14];
    const m15 = me[15];

    te[0] = m0;
    te[1] = m4;
    te[4] = m1;
    te[2] = m8;
    te[8] = m2;
    te[5] = m5;
    te[6] = m9;
    te[9] = m6;
    te[10] = m10;
    te[3] = m12;
    te[12] = m3;
    te[7] = m13;
    te[13] = m7;
    te[11] = m14;
    te[14] = m11;
    te[15] = m15;

    return out as this;
  }

  /**
   * Sets this matrix to the inverse of `m`
   *
   * When `m` can't be inverted (its determinant is 0), the result is the identity and a warning is
   * logged.
   * @example
   * ```ts
   * const worldToLocal = new Matrix4().getInverse(mesh.worldTransform);
   * ```
   * @param m - Matrix to invert
   * @param throwOnDegenerate - `true` throws instead of warning when `m` can't be inverted
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public getInverse(m: Matrix4, throwOnDegenerate?: boolean, out: Matrix4 = this): this {
    const te = out.elements;
    const me = m.elements;

    const n11 = me[0];
    const n21 = me[1];
    const n31 = me[2];
    const n41 = me[3];
    const n12 = me[4];
    const n22 = me[5];
    const n32 = me[6];
    const n42 = me[7];
    const n13 = me[8];
    const n23 = me[9];
    const n33 = me[10];
    const n43 = me[11];
    const n14 = me[12];
    const n24 = me[13];
    const n34 = me[14];
    const n44 = me[15];

    const t11 =
      n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
    const t12 =
      n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
    const t13 =
      n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
    const t14 =
      n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;

    const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;

    if (det === 0) {
      const msg = "Matrix4: .getInverse() can't invert matrix, determinant is 0";

      if (throwOnDegenerate === true) {
        throw new Error(msg);
      } else {
        warn(msg);
      }

      out.identity();
      return out as this;
    }

    const detInv = 1 / det;

    te[0] = t11 * detInv;
    te[1] =
      (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) *
      detInv;
    te[2] =
      (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) *
      detInv;
    te[3] =
      (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) *
      detInv;

    te[4] = t12 * detInv;
    te[5] =
      (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) *
      detInv;
    te[6] =
      (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) *
      detInv;
    te[7] =
      (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) *
      detInv;

    te[8] = t13 * detInv;
    te[9] =
      (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) *
      detInv;
    te[10] =
      (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) *
      detInv;
    te[11] =
      (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) *
      detInv;

    te[12] = t14 * detInv;
    te[13] =
      (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) *
      detInv;
    te[14] =
      (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) *
      detInv;
    te[15] =
      (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) *
      detInv;

    return out as this;
  }

  /**
   * Composes this matrix from a translation, rotation and scale
   *
   * A point is scaled first, then rotated, then moved: the order a {@link Container3D} builds its
   * {@link Container3D#localTransform} in.
   * @example
   * ```ts
   * const instance = new Matrix4();
   * const unitScale = { x: 1, y: 1, z: 1 };
   *
   * for (let i = 0; i < treeCount; i++) {
   *   instance.compose(treePositions[i], treeRotations[i], unitScale);
   *   instanceData.set(instance.elements, i * 16);
   * }
   * ```
   * @param position - Translation component
   * @param quaternion - Rotation component
   * @param scale - Scale component
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public compose(position: PointData3D, quaternion: Quaternion, scale: PointData3D, out: Matrix4 = this): this {
    const te = out.elements;

    const x = quaternion.x;
    const y = quaternion.y;
    const z = quaternion.z;
    const w = quaternion.w;

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

    const sx = scale.x;
    const sy = scale.y;
    const sz = scale.z;

    te[0] = (1 - (yy + zz)) * sx;
    te[1] = (xy + wz) * sx;
    te[2] = (xz - wy) * sx;
    te[3] = 0;

    te[4] = (xy - wz) * sy;
    te[5] = (1 - (xx + zz)) * sy;
    te[6] = (yz + wx) * sy;
    te[7] = 0;

    te[8] = (xz + wy) * sz;
    te[9] = (yz - wx) * sz;
    te[10] = (1 - (xx + yy)) * sz;
    te[11] = 0;

    te[12] = position.x;
    te[13] = position.y;
    te[14] = position.z;
    te[15] = 1;

    return out as this;
  }

  /**
   * Splits this matrix into a translation, rotation and scale
   *
   * A mirroring matrix (negative determinant) comes back with a negative X scale, so the rotation
   * stays a rotation. A sheared matrix has no exact split; the result only approximates it.
   * @example
   * ```ts
   * const position = new Vector3();
   * const rotation = new Quaternion();
   * const scale = new Vector3();
   *
   * mesh.worldTransform.decompose(position, rotation, scale);
   * ```
   * @param position - Receives the translation component
   * @param quaternion - Receives the rotation component
   * @param scale - Receives the scale component
   * @param out - Matrix that receives a copy of this one first; decomposing changes no matrix
   * @returns `out`, which is this matrix when omitted
   */
  public decompose(position: Vector3, quaternion: Quaternion, scale: Vector3, out: Matrix4 = this): this {
    if (out !== this) out.copyFrom(this);
    const te = out.elements;

    const m11 = te[0];
    const m21 = te[1];
    const m31 = te[2];
    const m12 = te[4];
    const m22 = te[5];
    const m32 = te[6];
    const m13 = te[8];
    const m23 = te[9];
    const m33 = te[10];

    let sx = Math.sqrt(m11 * m11 + m21 * m21 + m31 * m31);
    const sy = Math.sqrt(m12 * m12 + m22 * m22 + m32 * m32);
    const sz = Math.sqrt(m13 * m13 + m23 * m23 + m33 * m33);

    const det3 = m11 * (m22 * m33 - m32 * m23) - m12 * (m21 * m33 - m31 * m23) + m13 * (m21 * m32 - m31 * m22);
    if (det3 < 0) sx = -sx;

    position.x = te[12];
    position.y = te[13];
    position.z = te[14];

    const invSX = 1 / sx;
    const invSY = 1 / sy;
    const invSZ = 1 / sz;

    const me = matrix.elements;
    me[0] = m11 * invSX;
    me[1] = m21 * invSX;
    me[2] = m31 * invSX;
    me[4] = m12 * invSY;
    me[5] = m22 * invSY;
    me[6] = m32 * invSY;
    me[8] = m13 * invSZ;
    me[9] = m23 * invSZ;
    me[10] = m33 * invSZ;

    quaternion.setFromRotationMatrix(matrix);

    scale.x = sx;
    scale.y = sy;
    scale.z = sz;

    return out as this;
  }

  /**
   * Sets this matrix to a pure translation by `(x, y, z)`
   * @example
   * ```ts
   * const eyeOffset = new Matrix4().makeTranslation(0, 1.7, 0);
   * ```
   * @param x - Translation along x
   * @param y - Translation along y
   * @param z - Translation along z
   * @returns This matrix
   */
  public makeTranslation(x: number, y: number, z: number): this {
    return this.set(1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1);
  }

  /**
   * Sets this matrix to a scale by `(x, y, z)`; a negative factor mirrors that axis
   * @example
   * ```ts
   * const mirrorX = new Matrix4().makeScale(-1, 1, 1);
   * ```
   * @param x - Scale along x
   * @param y - Scale along y
   * @param z - Scale along z
   * @returns This matrix
   */
  public makeScale(x: number, y: number, z: number): this {
    return this.set(x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1);
  }

  /**
   * Sets this matrix to a shear, where each factor adds that multiple of a point's coordinate on
   * its axis to the point's other two coordinates
   *
   * With `y = 0.2`, a point 1 unit up moves 0.2 along both x and z. To shear one axis only, write
   * the matrix with {@link Matrix4#set}.
   * @example
   * ```ts
   * const lean = new Matrix4().makeShear(0, 0.2, 0);
   * ```
   * @param x - How much a point's x adds to its y and z
   * @param y - How much a point's y adds to its x and z
   * @param z - How much a point's z adds to its x and y
   * @returns This matrix
   */
  public makeShear(x: number, y: number, z: number): this {
    return this.set(1, y, z, 0, x, 1, z, 0, x, y, 1, 0, 0, 0, 0, 1);
  }

  /**
   * Sets this matrix to a rotation of `theta` radians around the X axis; positive angles turn +Y
   * toward +Z
   * @example
   * ```ts
   * const layFlat = new Matrix4().makeRotationX(-Math.PI / 2);
   * ```
   * @param theta - Rotation angle in radians
   * @returns This matrix
   */
  public makeRotationX(theta: number): this {
    const c = Math.cos(theta);
    const s = Math.sin(theta);

    return this.set(1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1);
  }

  /**
   * Sets this matrix to a rotation of `theta` radians around the Y axis; positive angles turn +Z
   * toward +X
   * @example
   * ```ts
   * const heading = new Matrix4().makeRotationY(yaw);
   * ```
   * @param theta - Rotation angle in radians
   * @returns This matrix
   */
  public makeRotationY(theta: number): this {
    const c = Math.cos(theta);
    const s = Math.sin(theta);

    return this.set(c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1);
  }

  /**
   * Sets this matrix to a rotation of `theta` radians around the Z axis; positive angles turn +X
   * toward +Y
   * @example
   * ```ts
   * const roll = new Matrix4().makeRotationZ(bankAngle);
   * ```
   * @param theta - Rotation angle in radians
   * @returns This matrix
   */
  public makeRotationZ(theta: number): this {
    const c = Math.cos(theta);
    const s = Math.sin(theta);

    return this.set(c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  }

  /**
   * Sets this matrix to a rotation of `angle` radians around `axis`
   *
   * Positive angles turn counter-clockwise as seen from the tip of `axis`, like the single-axis
   * methods.
   * @example
   * ```ts
   * const wobble = new Matrix4().makeRotationAxis(new Vector3(1, 0, 1).normalize(), 0.2);
   * ```
   * @param axis - Unit-length rotation axis
   * @param angle - Rotation angle in radians
   * @returns This matrix
   */
  public makeRotationAxis(axis: PointData3D, angle: number): this {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const t = 1 - c;
    const x = axis.x;
    const y = axis.y;
    const z = axis.z;
    const tx = t * x;
    const ty = t * y;

    return this.set(
      tx * x + c,
      tx * y - s * z,
      tx * z + s * y,
      0,
      tx * y + s * z,
      ty * y + c,
      ty * z - s * x,
      0,
      tx * z - s * y,
      ty * z + s * x,
      t * z * z + c,
      0,
      0,
      0,
      0,
      1,
    );
  }

  /**
   * Sets this matrix to a rotation derived from XYZ Euler angles in `rotation` (radians)
   *
   * The matrix is `Rx * Ry * Rz`, the convention {@link Container3D#rotation} and
   * {@link Quaternion#setFromEuler} use, so the same angles give the same orientation.
   * @example
   * ```ts
   * const facing = new Matrix4().makeRotationFromEuler({ x: 0, y: Math.PI / 2, z: 0 });
   * ```
   * @param rotation - Euler angles in radians
   * @returns This matrix
   */
  public makeRotationFromEuler(rotation: PointData3D): this {
    const te = this.elements;

    const a = Math.cos(rotation.x);
    const b = Math.sin(rotation.x);
    const c = Math.cos(rotation.y);
    const d = Math.sin(rotation.y);
    const e = Math.cos(rotation.z);
    const f = Math.sin(rotation.z);

    const ae = a * e;
    const af = a * f;
    const be = b * e;
    const bf = b * f;

    te[0] = c * e;
    te[4] = -c * f;
    te[8] = d;

    te[1] = af + be * d;
    te[5] = ae - bf * d;
    te[9] = -b * c;

    te[2] = bf - ae * d;
    te[6] = be + af * d;
    te[10] = a * c;

    te[3] = 0;
    te[7] = 0;
    te[11] = 0;

    te[12] = 0;
    te[13] = 0;
    te[14] = 0;
    te[15] = 1;

    return this;
  }

  /**
   * Sets this matrix to a rotation derived from the quaternion `q`
   * @example
   * ```ts
   * const quarterTurn = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
   * const rotation = new Matrix4().makeRotationFromQuaternion(quarterTurn);
   * ```
   * @param q - Rotation quaternion
   * @returns This matrix
   */
  public makeRotationFromQuaternion(q: Quaternion): this {
    return this.compose(zero, q, one);
  }

  /**
   * Sets this matrix to a perspective projection from a vertical field-of-view (radians), for a
   * camera looking down -Z
   *
   * Clip-space depth runs from -1 at `near` to 1 at `far`, as WebGL expects, and
   * {@link Camera3D#projection} is built the same way. On WebGPU, whose depth runs from 0 to 1, the
   * renderer remaps the copy it draws with, but a matrix you bind yourself, the camera's included,
   * needs the same remap. `fovy` is in radians, unlike {@link Camera3D#fov}, which is in degrees.
   * @example
   * ```ts
   * const projection = new Matrix4().makePerspective(Math.PI / 3, width / height, 0.1, 500);
   * ```
   * @param fovy - Vertical field-of-view in radians
   * @param aspect - Viewport width / height
   * @param near - Near clip distance
   * @param far - Far clip distance; leave it out or pass `Infinity` for no far plane
   * @returns This matrix
   */
  public makePerspective(fovy: number, aspect: number, near: number, far?: number): this {
    const te = this.elements;

    const f = 1.0 / Math.tan(fovy / 2);

    te[0] = f / aspect;
    te[1] = 0;
    te[2] = 0;
    te[3] = 0;
    te[4] = 0;
    te[5] = f;
    te[6] = 0;
    te[7] = 0;
    te[8] = 0;
    te[9] = 0;
    te[11] = -1;
    te[12] = 0;
    te[13] = 0;
    te[15] = 0;

    if (far !== undefined && far !== Infinity) {
      const nf = 1 / (near - far);
      te[10] = (far + near) * nf;
      te[14] = 2 * far * near * nf;
    } else {
      te[10] = -1;
      te[14] = -2 * near;
    }

    return this;
  }

  /**
   * Sets this matrix to an orthographic projection of the box between the given planes, for a
   * camera looking down -Z
   *
   * `top` comes before `bottom` in the arguments. Clip-space depth runs from -1 at `near` to 1 at
   * `far`, as with {@link Matrix4#makePerspective}.
   * @example
   * ```ts
   * const shadowProjection = new Matrix4().makeOrthographic(-20, 20, 20, -20, 0.5, 100);
   * ```
   * @param left - Left clip plane
   * @param right - Right clip plane
   * @param top - Top clip plane
   * @param bottom - Bottom clip plane
   * @param near - Near clip distance
   * @param far - Far clip distance
   * @returns This matrix
   */
  public makeOrthographic(left: number, right: number, top: number, bottom: number, near: number, far: number): this {
    const te = this.elements;
    const lr = 1 / (left - right);
    const bt = 1 / (bottom - top);
    const nf = 1 / (near - far);

    te[0] = -2 * lr;
    te[1] = 0;
    te[2] = 0;
    te[3] = 0;
    te[4] = 0;
    te[5] = -2 * bt;
    te[6] = 0;
    te[7] = 0;
    te[8] = 0;
    te[9] = 0;
    te[10] = 2 * nf;
    te[11] = 0;
    te[12] = (left + right) * lr;
    te[13] = (top + bottom) * bt;
    te[14] = (far + near) * nf;
    te[15] = 1;

    return this;
  }

  /**
   * Sets this matrix's rotation so its -Z axis points from `eye` toward `target`, with its +Y axis
   * as close to `up` as it can be
   *
   * That turns a camera at `eye` to face `target`. Only the rotation part is written; the
   * translation and bottom row stay (copied into `out` first when it is another matrix). Set the
   * position and invert the result to get the camera's view matrix. When `up` lies along the view
   * direction, the direction is nudged slightly so the result is still a rotation.
   * @example
   * ```ts
   * const cameraWorld = new Matrix4().lookAt(eye, target, { x: 0, y: 1, z: 0 }).setPosition(eye);
   * const view = new Matrix4().getInverse(cameraWorld);
   * ```
   * @param eye - Viewer position
   * @param target - Point to look toward
   * @param up - Up direction
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public lookAt(eye: PointData3D, target: PointData3D, up: PointData3D, out: Matrix4 = this): this {
    if (out !== this) out.copyFrom(this);
    const x = vector;
    const y = vector2;
    const z = vector3;

    const te = out.elements;

    z.x = eye.x - target.x;
    z.y = eye.y - target.y;
    z.z = eye.z - target.z;

    if (z.magnitudeSquared() === 0) {
      z.z = 1;
    }

    z.normalize();
    x.copyFrom(up).cross(z);

    if (x.magnitudeSquared() === 0) {
      if (Math.abs(up.z) === 1) {
        z.x += 0.0001;
      } else {
        z.z += 0.0001;
      }

      z.normalize();
      x.copyFrom(up).cross(z);
    }

    x.normalize();
    y.copyFrom(z).cross(x);

    te[0] = x.x;
    te[4] = y.x;
    te[8] = z.x;
    te[1] = x.y;
    te[5] = y.y;
    te[9] = z.y;
    te[2] = x.z;
    te[6] = y.z;
    te[10] = z.z;

    return out as this;
  }

  /**
   * Writes `(v.x, v.y, v.z)` into the translation column of this matrix, leaving the rest intact
   * @example
   * ```ts
   * const spawn = new Matrix4().makeRotationY(heading).setPosition(spawnPoint);
   * ```
   * @param v - Position to write
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public setPosition(v: PointData3D, out: Matrix4 = this): this {
    if (out !== this) out.copyFrom(this);
    const te = out.elements;

    te[12] = v.x;
    te[13] = v.y;
    te[14] = v.z;

    return out as this;
  }

  /**
   * Scales this matrix along its own axes by `(v.x, v.y, v.z)`
   *
   * Multiplies the first three columns, which is the same as multiplying by
   * {@link Matrix4#makeScale} on the right: the scale applies to a point first.
   * @example
   * ```ts
   * const doubled = mesh.worldTransform.clone().scale({ x: 2, y: 2, z: 2 });
   * ```
   * @param v - Per-axis scale factors
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public scale(v: PointData3D, out: Matrix4 = this): this {
    if (out !== this) out.copyFrom(this);
    const te = out.elements;
    const x = v.x;
    const y = v.y;
    const z = v.z;

    te[0] *= x;
    te[4] *= y;
    te[8] *= z;
    te[1] *= x;
    te[5] *= y;
    te[9] *= z;
    te[2] *= x;
    te[6] *= y;
    te[10] *= z;
    te[3] *= x;
    te[7] *= y;
    te[11] *= z;

    return out as this;
  }

  /**
   * Writes the translation column into `out`
   * @example
   * ```ts
   * const worldPosition = mesh.worldTransform.extractPosition(new Vector3());
   * ```
   * @param out - Point that receives the translation
   * @returns The given output point
   */
  public extractPosition<T extends PointLike3D>(out: T): T {
    const te = this.elements;

    out.set(te[12], te[13], te[14]);

    return out;
  }

  /**
   * Writes the per-axis scale (column magnitudes) into `out`
   *
   * The lengths are never negative, so a mirrored axis reads as a positive scale;
   * {@link Matrix4#decompose} reports the mirror.
   * @example
   * ```ts
   * const worldScale = mesh.worldTransform.extractScale(new Vector3());
   * ```
   * @param out - Point that receives the scale
   * @returns The given output point
   */
  public extractScale<T extends PointLike3D>(out: T): T {
    const te = this.elements;

    out.set(
      Math.sqrt(te[0] * te[0] + te[1] * te[1] + te[2] * te[2]),
      Math.sqrt(te[4] * te[4] + te[5] * te[5] + te[6] * te[6]),
      Math.sqrt(te[8] * te[8] + te[9] * te[9] + te[10] * te[10]),
    );

    return out;
  }

  /**
   * Writes the three basis vectors of this matrix into `xAxis`, `yAxis` and `zAxis`
   *
   * They are the first three columns: the matrix's own axes, scale included.
   * @example
   * ```ts
   * const right = new Vector3();
   * const up = new Vector3();
   * const back = new Vector3();
   *
   * camera.worldTransform.extractBasis(right, up, back);
   * ```
   * @param xAxis - Receives the X basis vector
   * @param yAxis - Receives the Y basis vector
   * @param zAxis - Receives the Z basis vector
   * @param out - Optional matrix that receives a copy of this matrix first
   * @returns The matrix the basis was read from
   */
  public extractBasis(xAxis: Vector3, yAxis: Vector3, zAxis: Vector3, out: Matrix4 = this): this {
    if (out !== this) out.copyFrom(this);
    xAxis.setFromMatrixColumn(out, 0);
    yAxis.setFromMatrixColumn(out, 1);
    zAxis.setFromMatrixColumn(out, 2);

    return out as this;
  }

  /**
   * Sets this matrix using the three basis vectors as its columns, with no translation
   *
   * Unit-length axes at right angles to each other make a rotation when `zAxis` is `xAxis` cross
   * `yAxis`, and a mirror when it points the other way.
   * @example
   * ```ts
   * const orientation = new Matrix4().makeBasis(right, up, back);
   * ```
   * @param xAxis - X basis vector
   * @param yAxis - Y basis vector
   * @param zAxis - Z basis vector
   * @returns This matrix
   */
  public makeBasis(xAxis: PointData3D, yAxis: PointData3D, zAxis: PointData3D): this {
    return this.set(
      xAxis.x,
      yAxis.x,
      zAxis.x,
      0,
      xAxis.y,
      yAxis.y,
      zAxis.y,
      0,
      xAxis.z,
      yAxis.z,
      zAxis.z,
      0,
      0,
      0,
      0,
      1,
    );
  }

  /**
   * Sets this matrix to `m` with each axis scaled to unit length and the translation cleared
   *
   * That removes only the scale: a mirroring matrix (negative determinant) gives a mirrored result,
   * and shear stays.
   * @example
   * ```ts
   * const rotationOnly = new Matrix4().extractRotation(mesh.worldTransform);
   * ```
   * @param m - Matrix to extract the rotation from
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public extractRotation(m: Matrix4, out: Matrix4 = this): this {
    const te = out.elements;
    const me = m.elements;

    const scaleX = 1 / vector.setFromMatrixColumn(m, 0).magnitude();
    const scaleY = 1 / vector.setFromMatrixColumn(m, 1).magnitude();
    const scaleZ = 1 / vector.setFromMatrixColumn(m, 2).magnitude();

    te[0] = me[0] * scaleX;
    te[1] = me[1] * scaleX;
    te[2] = me[2] * scaleX;
    te[3] = 0;

    te[4] = me[4] * scaleY;
    te[5] = me[5] * scaleY;
    te[6] = me[6] * scaleY;
    te[7] = 0;

    te[8] = me[8] * scaleZ;
    te[9] = me[9] * scaleZ;
    te[10] = me[10] * scaleZ;
    te[11] = 0;

    te[12] = 0;
    te[13] = 0;
    te[14] = 0;
    te[15] = 1;

    return out as this;
  }

  /**
   * Writes the negated Z column (forward direction, length 1) into `out`
   *
   * That is the way a {@link Camera3D} or a light faces. Other {@link Container3D}s, such as meshes,
   * face +Z, so for them this points backwards.
   * @example
   * ```ts
   * const aim = camera.worldTransform.extractForward(new Vector3());
   * ```
   * @param out - Point that receives the direction
   * @returns The given output point
   */
  public extractForward<T extends PointLike3D>(out: T): T {
    const e = this.elements;
    let x = -e[8];
    let y = -e[9];
    let z = -e[10];
    const inv = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    x *= inv;
    y *= inv;
    z *= inv;
    out.set(x, y, z);

    return out;
  }

  /**
   * Writes the X column (right direction, length 1) into `out`
   * @example
   * ```ts
   * camera.worldTransform.extractRight(right);
   * player.position.addScaledVector(right, strafeSpeed);
   * ```
   * @param out - Point that receives the direction
   * @returns The given output point
   */
  public extractRight<T extends PointLike3D>(out: T): T {
    const e = this.elements;
    let x = e[0];
    let y = e[1];
    let z = e[2];
    const inv = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    x *= inv;
    y *= inv;
    z *= inv;
    out.set(x, y, z);

    return out;
  }

  /**
   * Writes the Y column (up direction, length 1) into `out`
   * @example
   * ```ts
   * drone.worldTransform.extractUp(thrustDirection);
   * ```
   * @param out - Point that receives the direction
   * @returns The given output point
   */
  public extractUp<T extends PointLike3D>(out: T): T {
    const e = this.elements;
    let x = e[4];
    let y = e[5];
    let z = e[6];
    const inv = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    x *= inv;
    y *= inv;
    z *= inv;
    out.set(x, y, z);

    return out;
  }

  /**
   * Computes the largest of the three axis scales: the length of the longest of the first three
   * columns
   *
   * Scaling a bounding radius by it covers rotation and per-axis scale. Under shear, as when a
   * non-uniformly scaled parent holds a rotated child, the matrix can stretch some other direction
   * further; {@link Matrix4#getMaxSingularValueSq} measures that.
   * @example
   * ```ts
   * const worldRadius = localRadius * mesh.worldTransform.getMaxScaleOnAxis();
   * ```
   * @returns The largest axis scale
   */
  public getMaxScaleOnAxis(): number {
    const te = this.elements;

    const scaleXSq = te[0] * te[0] + te[1] * te[1] + te[2] * te[2];
    const scaleYSq = te[4] * te[4] + te[5] * te[5] + te[6] * te[6];
    const scaleZSq = te[8] * te[8] + te[9] * te[9] + te[10] * te[10];

    return Math.sqrt(Math.max(scaleXSq, scaleYSq, scaleZSq));
  }

  /**
   * Largest singular value of the upper-left 3x3, squared: the square of the most this matrix
   * stretches any direction
   *
   * A bounding radius scaled by its square root covers the transformed shape even under shear,
   * where {@link Matrix4#getMaxScaleOnAxis} can fall short; without shear, it's the square of that.
   * It comes back squared so a comparison against squared distances skips a square root.
   * @example
   * ```ts
   * const worldRadius = localRadius * Math.sqrt(mesh.worldTransform.getMaxSingularValueSq());
   * ```
   */
  public getMaxSingularValueSq(): number {
    const e = this.elements;
    const c0x = e[0];
    const c0y = e[1];
    const c0z = e[2];
    const c1x = e[4];
    const c1y = e[5];
    const c1z = e[6];
    const c2x = e[8];
    const c2y = e[9];
    const c2z = e[10];

    const a11 = c0x * c0x + c0y * c0y + c0z * c0z;
    const a22 = c1x * c1x + c1y * c1y + c1z * c1z;
    const a33 = c2x * c2x + c2y * c2y + c2z * c2z;
    const a12 = c0x * c1x + c0y * c1y + c0z * c1z;
    const a13 = c0x * c2x + c0y * c2y + c0z * c2z;
    const a23 = c1x * c2x + c1y * c2y + c1z * c2z;

    const p1 = a12 * a12 + a13 * a13 + a23 * a23;
    if (p1 === 0) {
      return Math.max(a11, a22, a33);
    }

    const q = (a11 + a22 + a33) / 3;
    const d11 = a11 - q;
    const d22 = a22 - q;
    const d33 = a33 - q;
    const p = Math.sqrt((d11 * d11 + d22 * d22 + d33 * d33 + 2 * p1) / 6);

    const b11 = d11 / p;
    const b22 = d22 / p;
    const b33 = d33 / p;
    const b12 = a12 / p;
    const b13 = a13 / p;
    const b23 = a23 / p;
    const detB = b11 * (b22 * b33 - b23 * b23) - b12 * (b12 * b33 - b23 * b13) + b13 * (b12 * b23 - b22 * b13);
    const r = Math.max(-1, Math.min(1, detB / 2));

    const eigMax = q + 2 * p * Math.cos(Math.acos(r) / 3);
    return Math.max(eigMax, 0);
  }
}

function _multiplyMatrices(a: Matrix4, b: Matrix4, target: Matrix4): Matrix4 {
  const ae = a.elements;
  const be = b.elements;
  const te = target.elements;

  const a11 = ae[0];
  const a12 = ae[4];
  const a13 = ae[8];
  const a14 = ae[12];
  const a21 = ae[1];
  const a22 = ae[5];
  const a23 = ae[9];
  const a24 = ae[13];
  const a31 = ae[2];
  const a32 = ae[6];
  const a33 = ae[10];
  const a34 = ae[14];
  const a41 = ae[3];
  const a42 = ae[7];
  const a43 = ae[11];
  const a44 = ae[15];

  const b11 = be[0];
  const b12 = be[4];
  const b13 = be[8];
  const b14 = be[12];
  const b21 = be[1];
  const b22 = be[5];
  const b23 = be[9];
  const b24 = be[13];
  const b31 = be[2];
  const b32 = be[6];
  const b33 = be[10];
  const b34 = be[14];
  const b41 = be[3];
  const b42 = be[7];
  const b43 = be[11];
  const b44 = be[15];

  te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
  te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
  te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
  te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;

  te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
  te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
  te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
  te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;

  te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
  te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
  te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
  te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;

  te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
  te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
  te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
  te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;

  return target;
}

const vector = new Vector3();
const vector2 = new Vector3();
const vector3 = new Vector3();

const matrix = new Matrix4();

const zero = new Vector3(0, 0, 0);
const one = new Vector3(1, 1, 1);

const _sharedMatrix = new Matrix4();
const _identityMatrix = new Matrix4();
