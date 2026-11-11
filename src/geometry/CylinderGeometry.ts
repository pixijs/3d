import { Geometry3D } from './Geometry3D';
import type { Geometry3DOptions } from './Geometry3D';
import { buildCylinderBuffers } from './utils/buildCylinderBuffers';

/**
 * Options for {@link CylinderGeometry}
 * @example
 * ```ts
 * const options: Partial<CylinderGeometryOptions> = { radiusTop: 0.5, radiusBottom: 0.5, height: 3 };
 * const column = new CylinderGeometry(options);
 * ```
 * @category geometry
 * @standard
 */
export interface CylinderGeometryOptions extends Geometry3DOptions {
  /**
   * The radius of the top ring, at `+height/2`; `0` collapses it to a point
   * @default 1
   * @example
   * ```ts
   * const bucket = new CylinderGeometry({ radiusTop: 1, radiusBottom: 0.7 });
   * ```
   */
  radiusTop: number;
  /**
   * The radius of the bottom ring, at `-height/2`; `0` collapses it to a point
   * @default 1
   * @example
   * ```ts
   * const lampshade = new CylinderGeometry({ radiusTop: 0.4, radiusBottom: 1, openEnded: true });
   * ```
   */
  radiusBottom: number;
  /**
   * The total height of the cylinder along the Y axis
   * @default 2
   * @example
   * ```ts
   * const coin = new CylinderGeometry({ height: 0.1 });
   * ```
   */
  height: number;
  /**
   * The number of segments around the circumference
   *
   * Floored, and clamped to a minimum of 3.
   * @default 32
   * @example
   * ```ts
   * const hexPrism = new CylinderGeometry({ radialSegments: 6 });
   * ```
   */
  radialSegments: number;
  /**
   * The number of segments along the height
   *
   * Floored, and clamped to a minimum of 1.
   * @default 1
   * @example
   * ```ts
   * const bendable = new CylinderGeometry({ height: 6, heightSegments: 24 });
   * ```
   */
  heightSegments: number;
  /**
   * When `true`, the end caps are skipped and only the side surface is generated
   * @default false
   * @example
   * ```ts
   * const tube = new CylinderGeometry({ openEnded: true });
   * ```
   */
  openEnded: boolean;
}

/**
 * A cylinder geometry oriented along the +Y axis and centered on the origin, with the top ring at
 * `+height/2` and the bottom ring at `-height/2`
 *
 * Unequal radii make a truncated cone. The side's normals are smooth and follow the slope between
 * the two radii. Its UVs wrap once around the circumference (`u` from 0 to 1), and `v` runs from 0
 * at the top to 1 at the bottom. A cap's UVs map it onto the circle inscribed in the texture.
 * @example
 * ```ts
 * const cylinder = new CylinderGeometry({
 *   radiusTop: 1,
 *   radiusBottom: 1,
 *   height: 2,
 *   radialSegments: 32,
 *   heightSegments: 1,
 *   openEnded: false,
 * });
 * ```
 * @see {@link CapsuleGeometry} For rounded caps instead of flat ends
 * @category geometry
 * @standard
 */
export class CylinderGeometry extends Geometry3D {
  /**
   * Defaults for every new `CylinderGeometry`
   * @example
   * ```ts
   * CylinderGeometry.defaultOptions.radialSegments = 16;
   * ```
   */
  public static defaultOptions: CylinderGeometryOptions = {
    ...Geometry3D.defaultOptions,
    radiusTop: 1,
    radiusBottom: 1,
    height: 2,
    radialSegments: 32,
    heightSegments: 1,
    openEnded: false,
  };

  /**
   * Creates a new `CylinderGeometry`
   * @param options - See {@link CylinderGeometryOptions} for available options
   */
  constructor(options: Partial<CylinderGeometryOptions> = {}) {
    const resolvedOptions = {
      ...CylinderGeometry.defaultOptions,
      ...options,
    };
    const { radiusTop, radiusBottom, height, radialSegments, heightSegments, openEnded } = resolvedOptions;
    const buffers = buildCylinderBuffers(radiusTop, radiusBottom, height, radialSegments, heightSegments, openEnded);

    super({
      ...resolvedOptions,
      ...buffers,
    });
  }
}
