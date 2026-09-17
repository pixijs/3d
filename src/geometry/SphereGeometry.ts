import { Geometry3D } from './Geometry3D';
import type { Geometry3DOptions } from './Geometry3D';
import { clampSegments } from './utils/clampSegments';

/**
 * Options for {@link SphereGeometry}
 * @category geometry
 * @standard
 */
export interface SphereGeometryOptions extends Geometry3DOptions {
  /**
   * The radius of the sphere
   * @default 1
   */
  radius: number;
  /**
   * The number of horizontal segments (longitudes around the +Y axis)
   *
   * Clamped to a minimum of 3; fewer would collapse the sphere into a degenerate shape.
   * @default 32
   */
  widthSegments: number;
  /**
   * The number of vertical segments (latitudes between the poles)
   *
   * Clamped to a minimum of 2.
   * @default 16
   */
  heightSegments: number;
}

/**
 * A UV sphere geometry built as a longitude-by-latitude grid around the +Y axis
 *
 * UVs run from `(0, 0)` at the south pole seam to `(1, 1)` at the north pole seam,
 * equirectangular-style.
 *
 * The pole rows produce intentionally degenerate triangles (zero area at the seam), which is the
 * standard UV-sphere trade-off. For uniform tessellation without pole pinching prefer
 * {@link IcosahedronGeometry}.
 * @example
 * ```ts
 * const sphere = new SphereGeometry({
 *   radius: 1,
 *   widthSegments: 32,
 *   heightSegments: 16,
 * });
 * ```
 * @see {@link Geometry3D} For the base geometry class
 * @see {@link Geometry3DOptions} For inherited geometry options
 * @see {@link IcosahedronGeometry} For a geodesic sphere with uniform tessellation
 * @category geometry
 * @standard
 */
export class SphereGeometry extends Geometry3D {
  /** Default options for {@link SphereGeometry} */
  public static defaultOptions: SphereGeometryOptions = {
    ...Geometry3D.defaultOptions,
    radius: 1,
    widthSegments: 32,
    heightSegments: 16,
  };

  /**
   * Creates a new `SphereGeometry`
   * @param options - See {@link SphereGeometryOptions} for available options
   */
  constructor(options: Partial<SphereGeometryOptions> = {}) {
    const resolvedOptions = {
      ...SphereGeometry.defaultOptions,
      ...options,
    };
    const { radius } = resolvedOptions;
    // Geometric minimums: a closed UV sphere needs ≥3 longitudes (otherwise
    // every "segment" collapses) and ≥2 latitudes (one band between the poles).
    const widthSegments = clampSegments(resolvedOptions.widthSegments, 3);
    const heightSegments = clampSegments(resolvedOptions.heightSegments, 2);

    const vertCount = (widthSegments + 1) * (heightSegments + 1);
    const triCount = (heightSegments - 1) * widthSegments * 2;

    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const indices = vertCount <= 65536 ? new Uint16Array(triCount * 3) : new Uint32Array(triCount * 3);

    const sinPhi = new Float64Array(heightSegments + 1);
    const cosPhi = new Float64Array(heightSegments + 1);

    for (let y = 0; y <= heightSegments; y++) {
      const phi = (y / heightSegments) * Math.PI;

      sinPhi[y] = Math.sin(phi);
      cosPhi[y] = Math.cos(phi);
    }

    const sinTheta = new Float64Array(widthSegments + 1);
    const cosTheta = new Float64Array(widthSegments + 1);

    for (let x = 0; x <= widthSegments; x++) {
      const theta = (x / widthSegments) * Math.PI * 2;

      sinTheta[x] = Math.sin(theta);
      cosTheta[x] = Math.cos(theta);
    }

    let posOffset = 0;
    let uvOffset = 0;

    for (let y = 0; y <= heightSegments; y++) {
      const v = y / heightSegments;
      const sp = sinPhi[y];
      const cp = cosPhi[y];

      for (let x = 0; x <= widthSegments; x++) {
        const u = x / widthSegments;
        const st = sinTheta[x];
        const ct = cosTheta[x];

        const nx = sp * ct;
        const ny = cp;
        const nz = sp * st;

        positions[posOffset] = nx * radius;
        positions[posOffset + 1] = ny * radius;
        positions[posOffset + 2] = nz * radius;

        normals[posOffset] = nx;
        normals[posOffset + 1] = ny;
        normals[posOffset + 2] = nz;

        posOffset += 3;

        uvs[uvOffset] = u;
        uvs[uvOffset + 1] = v;

        uvOffset += 2;
      }
    }

    const rowSize = widthSegments + 1;
    let idxOffset = 0;

    for (let y = 0; y < heightSegments; y++) {
      for (let x = 0; x < widthSegments; x++) {
        const a = y * rowSize + x;
        const b = a + 1;
        const c = a + rowSize;
        const d = c + 1;

        if (y !== 0) {
          indices[idxOffset] = a;
          indices[idxOffset + 1] = b;
          indices[idxOffset + 2] = c;
          idxOffset += 3;
        }
        if (y !== heightSegments - 1) {
          indices[idxOffset] = b;
          indices[idxOffset + 1] = d;
          indices[idxOffset + 2] = c;
          idxOffset += 3;
        }
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
