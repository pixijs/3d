import { Geometry3D } from './Geometry3D';
import type { Geometry3DOptions } from './Geometry3D';
import { clampSegments } from './utils/clampSegments';

/**
 * Options for {@link TorusGeometry}
 * @example
 * ```ts
 * const options: Partial<TorusGeometryOptions> = { radius: 2, tube: 0.25 };
 * const ring = new TorusGeometry(options);
 * ```
 * @category geometry
 * @standard
 */
export interface TorusGeometryOptions extends Geometry3DOptions {
  /**
   * The major radius, measured from the center of the torus to the center of the tube
   * @default 1
   * @example
   * ```ts
   * const hoop = new TorusGeometry({ radius: 3, tube: 0.1 });
   * ```
   */
  radius: number;
  /**
   * The radius of the tube
   *
   * Keep it below `radius`; a larger tube passes through itself at the center.
   * @default 0.4
   * @example
   * ```ts
   * const donut = new TorusGeometry({ radius: 1, tube: 0.6 });
   * ```
   */
  tube: number;
  /**
   * The number of segments around the tube cross-section
   *
   * Floored, and clamped to a minimum of 3.
   * @default 12
   * @example
   * ```ts
   * const smooth = new TorusGeometry({ radialSegments: 32, tubularSegments: 96 });
   * ```
   */
  radialSegments: number;
  /**
   * The number of segments around the torus ring
   *
   * Floored, and clamped to a minimum of 3.
   * @default 48
   * @example
   * ```ts
   * const hexRing = new TorusGeometry({ tubularSegments: 6 });
   * ```
   */
  tubularSegments: number;
  /**
   * The arc angle in radians swept around the ring (the +Y axis)
   *
   * Defaults to `2π` for a closed torus; pass a smaller value (for example `Math.PI` for a half
   * torus) to leave the ring open.
   * @default Math.PI * 2
   * @example
   * ```ts
   * const arch = new TorusGeometry({ arc: Math.PI });
   * ```
   */
  arc: number;
  /**
   * Start angle in radians for the cross-section sweep, measured from the outer edge of the ring
   *
   * Combined with `thetaLength` to leave the tube cross-section open, for example for a gutter-like
   * half tube.
   * @default 0
   * @example
   * ```ts
   * const gutter = new TorusGeometry({ thetaStart: Math.PI, thetaLength: Math.PI });
   * ```
   */
  thetaStart: number;
  /**
   * Sweep length in radians for the cross-section
   *
   * Defaults to `2π` for a closed tube.
   * @default Math.PI * 2
   * @example
   * ```ts
   * const outerHalf = new TorusGeometry({ thetaStart: -Math.PI / 2, thetaLength: Math.PI });
   * ```
   */
  thetaLength: number;
}

/**
 * A torus (donut) geometry built from a ring of `tubularSegments` cross-sections, each a circle
 * of `radialSegments` vertices
 *
 * The ring lies in the XZ plane and the symmetry axis is +Y, matching the rest of the primitive
 * set ({@link CylinderGeometry}, {@link SphereGeometry}, etc.). Lower `arc` values produce a
 * partial ring; `thetaStart`/`thetaLength` open the cross-section.
 *
 * UVs map `u` around the ring (0 at the start of the arc, 1 at the end) and `v` around the tube
 * cross-section (0 at `thetaStart`, 1 at the end of `thetaLength`).
 * @example
 * ```ts
 * const torus = new TorusGeometry({
 *   radius: 1,
 *   tube: 0.4,
 *   radialSegments: 12,
 *   tubularSegments: 48,
 *   arc: Math.PI * 2,
 * });
 * ```
 * @see {@link Geometry3D} For the base geometry class
 * @see {@link Geometry3DOptions} For inherited geometry options
 * @see {@link TorusKnotGeometry} For a tube wrapped along a `(p, q)` torus knot path
 * @category geometry
 * @standard
 */
export class TorusGeometry extends Geometry3D {
  /**
   * Default options for {@link TorusGeometry}
   * @example
   * ```ts
   * TorusGeometry.defaultOptions.tube = 0.2;
   * ```
   */
  public static defaultOptions: TorusGeometryOptions = {
    ...Geometry3D.defaultOptions,
    radius: 1,
    tube: 0.4,
    radialSegments: 12,
    tubularSegments: 48,
    arc: Math.PI * 2,
    thetaStart: 0,
    thetaLength: Math.PI * 2,
  };

  /**
   * Creates a new `TorusGeometry`
   * @param options - See {@link TorusGeometryOptions} for available options
   */
  constructor(options: Partial<TorusGeometryOptions> = {}) {
    const resolvedOptions = {
      ...TorusGeometry.defaultOptions,
      ...options,
    };
    const { radius, tube, arc, thetaStart, thetaLength } = resolvedOptions;
    const radialSegmentCount = clampSegments(resolvedOptions.radialSegments, 3);
    const tubularSegmentCount = clampSegments(resolvedOptions.tubularSegments, 3);

    const vertCount = (radialSegmentCount + 1) * (tubularSegmentCount + 1);
    const idxCount = radialSegmentCount * tubularSegmentCount * 6;

    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const indices = vertCount > 65536 ? new Uint32Array(idxCount) : new Uint16Array(idxCount);

    const cosU = new Float64Array(tubularSegmentCount + 1);
    const sinU = new Float64Array(tubularSegmentCount + 1);

    for (let i = 0; i <= tubularSegmentCount; i++) {
      const u = (i / tubularSegmentCount) * arc;

      cosU[i] = Math.cos(u);
      sinU[i] = Math.sin(u);
    }

    let posIdx = 0;
    let normIdx = 0;
    let uvIdx = 0;

    for (let j = 0; j <= radialSegmentCount; j++) {
      const v = thetaStart + (j / radialSegmentCount) * thetaLength;
      const cosV = Math.cos(v);
      const sinV = Math.sin(v);
      const vRow = j / radialSegmentCount;
      const ringRadius = radius + tube * cosV;
      const yOffset = tube * sinV;

      for (let i = 0; i <= tubularSegmentCount; i++) {
        const cu = cosU[i];
        const su = sinU[i];

        positions[posIdx++] = ringRadius * cu;
        positions[posIdx++] = yOffset;
        positions[posIdx++] = ringRadius * su;

        normals[normIdx++] = cosV * cu;
        normals[normIdx++] = sinV;
        normals[normIdx++] = cosV * su;

        uvs[uvIdx++] = i / tubularSegmentCount;
        uvs[uvIdx++] = vRow;
      }
    }

    const rowSize = tubularSegmentCount + 1;
    let idxIdx = 0;

    for (let j = 1; j <= radialSegmentCount; j++) {
      for (let i = 1; i <= tubularSegmentCount; i++) {
        const a = rowSize * j + i - 1;
        const b = rowSize * (j - 1) + i - 1;
        const c = rowSize * (j - 1) + i;
        const d = rowSize * j + i;

        indices[idxIdx++] = a;
        indices[idxIdx++] = d;
        indices[idxIdx++] = b;
        indices[idxIdx++] = b;
        indices[idxIdx++] = d;
        indices[idxIdx++] = c;
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
