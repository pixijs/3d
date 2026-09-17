import { warn } from 'pixi.js';

import type { TypedFixedArray } from '../utils/misc';
import type { Matrix4 } from './Matrix4';

/**
 * The `Matrix3` object represents a 3x3 column-major matrix used for 2D affine transforms,
 * normal-matrix derivation and KHR_texture_transform UV math
 *
 * The 9 elements are stored in column-major order matching the WebGL/WebGPU uniform layout.
 *
 * Math operations follow the unified mutating-default pattern: `a.multiply(b)` mutates `a`;
 * `a.multiply(b, out)` writes the result into `out` without mutating `a`.
 * @example
 * ```ts
 * // 2D affine transform
 * const t = new Matrix3().translate(10, 5).rotate(Math.PI / 4).scale(2, 2);
 *
 * // Normal matrix derived from a world matrix
 * const normalMatrix = new Matrix3().getNormalMatrix(worldMatrix);
 *
 * // Pixi-style aliases
 * t.append(t);          // same as multiply
 * t.prepend(t);         // same as premultiply
 * ```
 * @see {@link Matrix4} For the 4x4 counterpart
 * @category maths
 * @standard
 */
export class Matrix3 {
  /** Column-major Float32 storage of the 9 matrix elements, suitable for direct GPU upload */
  public elements: TypedFixedArray<9>;

  /**
   * Lazily-allocated Float32Array populated by {@link Matrix3#toArray}
   * @default null
   */
  public array: Float32Array | null = null;

  /**
   * A static `Matrix3` reset to identity on every access
   *
   * > [!IMPORTANT] This matrix is shared and temporary. Do not store references to it.
   */
  static get shared(): Matrix3 {
    return _sharedMatrix.identity();
  }

  /**
   * A read-only identity matrix
   *
   * > [!IMPORTANT] This is a shared instance; do not mutate it. Use {@link Matrix3.shared} when you
   * > need a writable temporary.
   */
  static get IDENTITY(): Readonly<Matrix3> {
    return _identityMatrix.identity();
  }

  /**
   * Creates a new `Matrix3`, defaulting to the identity matrix
   * @param elements - Optional column-major 9-element backing array
   */
  constructor(elements?: TypedFixedArray<9>) {
    this.elements = elements || (new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]) as TypedFixedArray<9>);
  }

  /**
   * Sets the 9 elements from row-major arguments (`nRC` = row R, column C)
   * @param n11 - Row 1, column 1
   * @param n12 - Row 1, column 2
   * @param n13 - Row 1, column 3
   * @param n21 - Row 2, column 1
   * @param n22 - Row 2, column 2
   * @param n23 - Row 2, column 3
   * @param n31 - Row 3, column 1
   * @param n32 - Row 3, column 2
   * @param n33 - Row 3, column 3
   * @returns This matrix
   */
  public set(
    n11: number,
    n12: number,
    n13: number,
    n21: number,
    n22: number,
    n23: number,
    n31: number,
    n32: number,
    n33: number,
  ): this {
    const te = this.elements;

    te[0] = n11;
    te[1] = n21;
    te[2] = n31;
    te[3] = n12;
    te[4] = n22;
    te[5] = n32;
    te[6] = n13;
    te[7] = n23;
    te[8] = n33;

    return this;
  }

  /**
   * Resets this matrix to the identity matrix
   * @returns This matrix
   */
  public identity(): this {
    return this.set(1, 0, 0, 0, 1, 0, 0, 0, 1);
  }

  /**
   * Checks whether this matrix equals the identity matrix exactly
   * @returns True when every element matches the identity matrix
   */
  public isIdentity(): boolean {
    const e = this.elements;

    return (
      e[0] === 1 &&
      e[1] === 0 &&
      e[2] === 0 &&
      e[3] === 0 &&
      e[4] === 1 &&
      e[5] === 0 &&
      e[6] === 0 &&
      e[7] === 0 &&
      e[8] === 1
    );
  }

  /**
   * Copies the elements of `m` into this matrix
   * @param m - Matrix to copy from
   * @returns This matrix
   */
  public copyFrom(m: Matrix3): this {
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

    return this;
  }

  /**
   * Copies this matrix's elements into `target`
   * @param target - Matrix to copy into
   * @returns The given target matrix
   */
  public copyTo<T extends Matrix3>(target: T): T {
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

    return target;
  }

  /**
   * Checks whether all 9 elements of this matrix match `m` exactly (no epsilon tolerance)
   * @param m - Matrix to compare against
   * @returns True when every element matches
   */
  public equals(m: Matrix3): boolean {
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
      te[8] === me[8]
    );
  }

  /**
   * Creates a new `Matrix3` with the same elements
   * @returns The new matrix
   */
  public clone(): Matrix3 {
    return new Matrix3().copyFrom(this);
  }

  /**
   * Formats this matrix as a readable row-by-row string
   * @returns The string representation
   */
  public toString(): string {
    const e = this.elements;

    return `[pixi-3d/math:Matrix3 [${e[0]}, ${e[3]}, ${e[6]} | ${e[1]}, ${e[4]}, ${e[7]} | ${e[2]}, ${e[5]}, ${e[8]}]]`;
  }

  /**
   * Reads the 9 elements from `array` (column-major) starting at `offset`
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

    return this;
  }

  /**
   * Writes this matrix's elements into a Float32Array
   *
   * The result lives in the lazily-allocated {@link Matrix3#array} field on first call when no
   * `out` is supplied.
   * @param transpose - When `true`, writes row-major; default writes column-major (matching {@link Matrix3#elements})
   * @param out - Optional destination array
   * @returns The populated array
   */
  public toArray(transpose?: boolean, out?: Float32Array): Float32Array {
    if (!this.array) this.array = new Float32Array(9);
    const arr = out || this.array;
    const e = this.elements;

    if (transpose) {
      arr[0] = e[0];
      arr[1] = e[3];
      arr[2] = e[6];
      arr[3] = e[1];
      arr[4] = e[4];
      arr[5] = e[7];
      arr[6] = e[2];
      arr[7] = e[5];
      arr[8] = e[8];
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
    }

    return arr;
  }

  /**
   * Multiplies this matrix by `m`: `this = this * m`
   * @param m - Matrix to multiply by
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public multiply(m: Matrix3, out: Matrix3 = this): this {
    _multiplyMatrices(this, m, out);

    return out as this;
  }

  /**
   * Pre-multiplies this matrix by `m`: `this = m * this`
   * @param m - Matrix to pre-multiply by
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public premultiply(m: Matrix3, out: Matrix3 = this): this {
    _multiplyMatrices(m, this, out);

    return out as this;
  }

  /**
   * Sets this matrix to `a * b`
   * @param a - Left operand
   * @param b - Right operand
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public multiplyMatrices(a: Matrix3, b: Matrix3, out: Matrix3 = this): this {
    _multiplyMatrices(a, b, out);

    return out as this;
  }

  /**
   * Multiplies every element of this matrix by the scalar `s`
   * @param s - Scalar to multiply by
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public multiplyScalar(s: number, out: Matrix3 = this): this {
    const te = out.elements;
    const se = this.elements;

    te[0] = se[0] * s;
    te[3] = se[3] * s;
    te[6] = se[6] * s;
    te[1] = se[1] * s;
    te[4] = se[4] * s;
    te[7] = se[7] * s;
    te[2] = se[2] * s;
    te[5] = se[5] * s;
    te[8] = se[8] * s;

    return out as this;
  }

  /**
   * Pixi-style alias for {@link Matrix3#multiply}
   *
   * Combines two matrices: `this = this * m`.
   * @param m - Matrix to append
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public append(m: Matrix3, out: Matrix3 = this): this {
    return this.multiply(m, out);
  }

  /**
   * Pixi-style alias for {@link Matrix3#premultiply}
   *
   * Combines two matrices: `this = m * this`.
   * @param m - Matrix to prepend
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public prepend(m: Matrix3, out: Matrix3 = this): this {
    return this.premultiply(m, out);
  }

  /**
   * Pixi-style alias for {@link Matrix3#multiplyMatrices}
   *
   * Sets this matrix to `a * b`.
   * @param a - Left operand
   * @param b - Right operand
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public appendFrom(a: Matrix3, b: Matrix3, out: Matrix3 = this): this {
    return this.multiplyMatrices(a, b, out);
  }

  /**
   * Computes the determinant of this matrix
   * @returns The determinant
   */
  public determinant(): number {
    const te = this.elements;

    const a = te[0];
    const b = te[1];
    const c = te[2];
    const d = te[3];
    const e = te[4];
    const f = te[5];
    const g = te[6];
    const h = te[7];
    const i = te[8];

    return a * e * i - a * f * h - b * d * i + b * f * g + c * d * h - c * e * g;
  }

  /**
   * Transposes this matrix
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public transpose(out: Matrix3 = this): this {
    const m = this.elements;
    const te = out.elements;

    const m0 = m[0];
    const m1 = m[1];
    const m2 = m[2];
    const m3 = m[3];
    const m4 = m[4];
    const m5 = m[5];
    const m6 = m[6];
    const m7 = m[7];
    const m8 = m[8];

    te[0] = m0;
    te[1] = m3;
    te[2] = m6;
    te[3] = m1;
    te[4] = m4;
    te[5] = m7;
    te[6] = m2;
    te[7] = m5;
    te[8] = m8;

    return out as this;
  }

  /**
   * Sets this matrix to the inverse of `m`
   *
   * When `m` is non-invertible (determinant is 0) the matrix is reset to identity. By default this
   * also emits a console warning; pass `throwOnDegenerate = true` to throw instead.
   * @param m - Matrix to invert
   * @param throwOnDegenerate - When `true`, throws on a non-invertible matrix instead of warning
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public getInverse(m: Matrix3, throwOnDegenerate?: boolean, out: Matrix3 = this): this {
    const me = m.elements;
    const te = out.elements;

    const n11 = me[0];
    const n21 = me[1];
    const n31 = me[2];
    const n12 = me[3];
    const n22 = me[4];
    const n32 = me[5];
    const n13 = me[6];
    const n23 = me[7];
    const n33 = me[8];

    const t11 = n33 * n22 - n32 * n23;
    const t12 = n32 * n13 - n33 * n12;
    const t13 = n23 * n12 - n22 * n13;

    const det = n11 * t11 + n21 * t12 + n31 * t13;

    if (det === 0) {
      const msg = "Matrix3: .getInverse() can't invert matrix, determinant is 0";

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
    te[1] = (n31 * n23 - n33 * n21) * detInv;
    te[2] = (n32 * n21 - n31 * n22) * detInv;

    te[3] = t12 * detInv;
    te[4] = (n33 * n11 - n31 * n13) * detInv;
    te[5] = (n31 * n12 - n32 * n11) * detInv;

    te[6] = t13 * detInv;
    te[7] = (n21 * n13 - n23 * n11) * detInv;
    te[8] = (n22 * n11 - n21 * n12) * detInv;

    return out as this;
  }

  /**
   * Translates this matrix by `(tx, ty)` (2D affine)
   * @param tx - Translation along x
   * @param ty - Translation along y
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public translate(tx: number, ty: number, out: Matrix3 = this): this {
    if (out !== this) out.copyFrom(this);
    const te = out.elements;

    te[0] += tx * te[2];
    te[3] += tx * te[5];
    te[6] += tx * te[8];
    te[1] += ty * te[2];
    te[4] += ty * te[5];
    te[7] += ty * te[8];

    return out as this;
  }

  /**
   * Scales this matrix by `(sx, sy)` (2D affine)
   * @param sx - Scale along x
   * @param sy - Scale along y
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public scale(sx: number, sy: number, out: Matrix3 = this): this {
    if (out !== this) out.copyFrom(this);
    const te = out.elements;

    te[0] *= sx;
    te[3] *= sx;
    te[6] *= sx;
    te[1] *= sy;
    te[4] *= sy;
    te[7] *= sy;

    return out as this;
  }

  /**
   * Rotates this matrix by `theta` radians around the origin (2D affine)
   *
   * The rotation applies after the existing transform, and a positive angle turns +x toward +y,
   * the same as pixi's `Matrix.rotate`.
   * @param theta - Rotation angle in radians
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public rotate(theta: number, out: Matrix3 = this): this {
    if (out !== this) out.copyFrom(this);
    const c = Math.cos(theta);
    const s = Math.sin(theta);

    const te = out.elements;

    const a11 = te[0];
    const a12 = te[3];
    const a13 = te[6];
    const a21 = te[1];
    const a22 = te[4];
    const a23 = te[7];

    te[0] = c * a11 - s * a21;
    te[3] = c * a12 - s * a22;
    te[6] = c * a13 - s * a23;

    te[1] = s * a11 + c * a21;
    te[4] = s * a12 + c * a22;
    te[7] = s * a13 + c * a23;

    return out as this;
  }

  /**
   * Sets this matrix to a UV transform combining translation, scale, rotation around `(cx, cy)`
   *
   * Matches the glTF KHR_texture_transform layout.
   * @param tx - Translation along u
   * @param ty - Translation along v
   * @param sx - Scale along u
   * @param sy - Scale along v
   * @param rotation - Rotation angle in radians
   * @param cx - Rotation center u
   * @param cy - Rotation center v
   * @returns This matrix
   */
  public setUvTransform(
    tx: number,
    ty: number,
    sx: number,
    sy: number,
    rotation: number,
    cx: number,
    cy: number,
  ): this {
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);

    return this.set(
      sx * c,
      sx * s,
      -sx * (c * cx + s * cy) + cx + tx,
      -sy * s,
      sy * c,
      -sy * (-s * cx + c * cy) + cy + ty,
      0,
      0,
      1,
    );
  }

  /**
   * Sets this matrix to the upper-left 3x3 block of the given {@link Matrix4}
   * @param m - Matrix to read from
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public setFromMatrix4(m: Matrix4, out: Matrix3 = this): this {
    const me = m.elements;

    out.set(me[0], me[4], me[8], me[1], me[5], me[9], me[2], me[6], me[10]);

    return out as this;
  }

  /**
   * Sets this matrix to the normal matrix of `matrix4` — the inverse-transpose of its upper-left
   * 3x3 block
   *
   * Used to transform direction vectors (normals) when a model has non-uniform scale.
   * @param matrix4 - World matrix to derive the normal matrix from
   * @param out - Optional target; defaults to writing into this matrix
   * @returns The matrix the result was written to
   */
  public getNormalMatrix(matrix4: Matrix4, out: Matrix3 = this): this {
    out.setFromMatrix4(matrix4).getInverse(out).transpose();

    return out as this;
  }
}

function _multiplyMatrices(a: Matrix3, b: Matrix3, target: Matrix3): Matrix3 {
  const ae = a.elements;
  const be = b.elements;
  const te = target.elements;

  const a11 = ae[0];
  const a12 = ae[3];
  const a13 = ae[6];
  const a21 = ae[1];
  const a22 = ae[4];
  const a23 = ae[7];
  const a31 = ae[2];
  const a32 = ae[5];
  const a33 = ae[8];

  const b11 = be[0];
  const b12 = be[3];
  const b13 = be[6];
  const b21 = be[1];
  const b22 = be[4];
  const b23 = be[7];
  const b31 = be[2];
  const b32 = be[5];
  const b33 = be[8];

  te[0] = a11 * b11 + a12 * b21 + a13 * b31;
  te[3] = a11 * b12 + a12 * b22 + a13 * b32;
  te[6] = a11 * b13 + a12 * b23 + a13 * b33;

  te[1] = a21 * b11 + a22 * b21 + a23 * b31;
  te[4] = a21 * b12 + a22 * b22 + a23 * b32;
  te[7] = a21 * b13 + a22 * b23 + a23 * b33;

  te[2] = a31 * b11 + a32 * b21 + a33 * b31;
  te[5] = a31 * b12 + a32 * b22 + a33 * b32;
  te[8] = a31 * b13 + a32 * b23 + a33 * b33;

  return target;
}

const _sharedMatrix = new Matrix3();
const _identityMatrix = new Matrix3();
