import { Geometry3D } from './Geometry3D';
import type { Geometry3DOptions } from './Geometry3D';
import { clampSegments } from './utils/clampSegments';

/**
 * Options for {@link TorusKnotGeometry}
 * @example
 * ```ts
 * const options: Partial<TorusKnotGeometryOptions> = { p: 3, q: 5, tube: 0.2 };
 * const knot = new TorusKnotGeometry(options);
 * ```
 * @category geometry
 * @standard
 */
export interface TorusKnotGeometryOptions extends Geometry3DOptions {
  /**
   * The overall scale of the knot; the centerline stays between `0.5 * radius` and `1.5 * radius`
   * from the Y axis
   * @default 1
   * @example
   * ```ts
   * const big = new TorusKnotGeometry({ radius: 4, tube: 0.8 });
   * ```
   */
  radius: number;
  /**
   * The radius of the tube swept along the knot path
   * @default 0.4
   * @example
   * ```ts
   * const wire = new TorusKnotGeometry({ tube: 0.05 });
   * ```
   */
  tube: number;
  /**
   * The number of segments along the knot's centerline
   *
   * Floored, and clamped to a minimum of 3. Tightly wound knots need more to stay smooth.
   * @default 64
   * @example
   * ```ts
   * const smooth = new TorusKnotGeometry({ p: 3, q: 7, tubularSegments: 256 });
   * ```
   */
  tubularSegments: number;
  /**
   * The number of segments around the tube cross-section
   *
   * Floored, and clamped to a minimum of 3.
   * @default 8
   * @example
   * ```ts
   * const roundTube = new TorusKnotGeometry({ radialSegments: 16 });
   * ```
   */
  radialSegments: number;
  /**
   * The number of times the knot winds around its axis of rotational symmetry
   *
   * Share no factor with `q` for a true `(p, q)` torus knot.
   * @default 2
   * @example
   * ```ts
   * const cinquefoil = new TorusKnotGeometry({ p: 2, q: 5 });
   * ```
   */
  p: number;
  /**
   * The number of times the knot winds around a circle in the interior of the torus
   *
   * Together with `p` chooses the knot type; `(2, 3)` is a trefoil, `(3, 7)` is more wound.
   * @default 3
   * @example
   * ```ts
   * const trefoil = new TorusKnotGeometry({ p: 2, q: 3 });
   * ```
   */
  q: number;
}

/**
 * A torus knot geometry, formed by sweeping a circular tube along a `(p, q)` torus knot path
 *
 * The centerline winds `p` times around the +Y axis (the torus's axis of symmetry) and `q` times
 * through its hole; for example `(2, 3)` is a trefoil and `(3, 7)` produces a more tightly wound
 * knot. When `p` and `q` share a factor, the tube runs over the same loop more than once.
 *
 * For whole-number `p` and `q` the tube's two ends meet exactly.
 * @example
 * ```ts
 * const trefoil = new TorusKnotGeometry({
 *   radius: 1,
 *   tube: 0.4,
 *   tubularSegments: 64,
 *   radialSegments: 8,
 *   p: 2,
 *   q: 3,
 * });
 * ```
 * @see {@link Geometry3D} For the base geometry class
 * @see {@link Geometry3DOptions} For inherited geometry options
 * @see {@link TorusGeometry} For a plain torus without the knot winding
 * @category geometry
 * @standard
 */
export class TorusKnotGeometry extends Geometry3D {
  /**
   * Default options for {@link TorusKnotGeometry}
   * @example
   * ```ts
   * TorusKnotGeometry.defaultOptions.tubularSegments = 128;
   * ```
   */
  public static defaultOptions: TorusKnotGeometryOptions = {
    ...Geometry3D.defaultOptions,
    radius: 1,
    tube: 0.4,
    tubularSegments: 64,
    radialSegments: 8,
    p: 2,
    q: 3,
  };

  /**
   * Creates a new `TorusKnotGeometry`
   * @param options - See {@link TorusKnotGeometryOptions} for available options
   */
  constructor(options: Partial<TorusKnotGeometryOptions> = {}) {
    const resolvedOptions = {
      ...TorusKnotGeometry.defaultOptions,
      ...options,
    };
    const { radius, tube, p, q } = resolvedOptions;
    const tubularSegmentCount = clampSegments(resolvedOptions.tubularSegments, 3);
    const radialSegmentCount = clampSegments(resolvedOptions.radialSegments, 3);

    const vertCount = (radialSegmentCount + 1) * (tubularSegmentCount + 1);
    const idxCount = radialSegmentCount * tubularSegmentCount * 6;

    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const indices = vertCount > 65536 ? new Uint32Array(idxCount) : new Uint16Array(idxCount);

    const cosV = new Float64Array(radialSegmentCount + 1);
    const sinV = new Float64Array(radialSegmentCount + 1);

    for (let j = 0; j <= radialSegmentCount; j++) {
      const v = (j / radialSegmentCount) * Math.PI * 2;

      cosV[j] = Math.cos(v);
      sinV[j] = Math.sin(v);
    }

    const k = q / p;
    let posIdx = 0;
    let normIdx = 0;
    let uvIdx = 0;

    for (let i = 0; i <= tubularSegmentCount; i++) {
      const u = (i / tubularSegmentCount) * p * Math.PI * 2;
      const cosU = Math.cos(u);
      const sinU = Math.sin(u);
      const cosKu = Math.cos(k * u);
      const sinKu = Math.sin(k * u);
      const radial = (2 + cosKu) * 0.5;
      const cx = radius * radial * cosU;
      const cy = radius * sinKu * 0.5;
      const cz = radius * radial * sinU;

      const tx = radius * 0.5 * (-k * sinKu * cosU - (2 + cosKu) * sinU);
      const ty = radius * 0.5 * k * cosKu;
      const tz = radius * 0.5 * (-k * sinKu * sinU + (2 + cosKu) * cosU);

      const bxRaw = ty * cz - tz * cy;
      const byRaw = tz * cx - tx * cz;
      const bzRaw = tx * cy - ty * cx;
      const binormalLen = Math.sqrt(bxRaw * bxRaw + byRaw * byRaw + bzRaw * bzRaw);
      const bx = bxRaw / binormalLen;
      const by = byRaw / binormalLen;
      const bz = bzRaw / binormalLen;

      const nxRaw = by * tz - bz * ty;
      const nyRaw = bz * tx - bx * tz;
      const nzRaw = bx * ty - by * tx;
      const normalLen = Math.sqrt(nxRaw * nxRaw + nyRaw * nyRaw + nzRaw * nzRaw);
      const nx = nxRaw / normalLen;
      const ny = nyRaw / normalLen;
      const nz = nzRaw / normalLen;

      const uRow = i / tubularSegmentCount;

      for (let j = 0; j <= radialSegmentCount; j++) {
        const cosVj = cosV[j];
        const sinVj = sinV[j];
        const radialNx = -cosVj * nx + sinVj * bx;
        const radialNy = -cosVj * ny + sinVj * by;
        const radialNz = -cosVj * nz + sinVj * bz;

        positions[posIdx++] = cx + tube * radialNx;
        positions[posIdx++] = cy + tube * radialNy;
        positions[posIdx++] = cz + tube * radialNz;

        normals[normIdx++] = radialNx;
        normals[normIdx++] = radialNy;
        normals[normIdx++] = radialNz;

        uvs[uvIdx++] = uRow;
        uvs[uvIdx++] = j / radialSegmentCount;
      }
    }

    const rowSize = radialSegmentCount + 1;
    let idxIdx = 0;

    for (let j = 1; j <= tubularSegmentCount; j++) {
      for (let i = 1; i <= radialSegmentCount; i++) {
        const a = rowSize * (j - 1) + (i - 1);
        const b = rowSize * j + (i - 1);
        const c = rowSize * j + i;
        const d = rowSize * (j - 1) + i;

        indices[idxIdx++] = a;
        indices[idxIdx++] = b;
        indices[idxIdx++] = d;
        indices[idxIdx++] = b;
        indices[idxIdx++] = c;
        indices[idxIdx++] = d;
      }
    }

    super({
      ...resolvedOptions,
      positions,
      normals,
      uvs,
      indices,
    });
  }
}
