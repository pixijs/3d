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
   * The radius of the top ring (at `+height/2`)
   *
   * Set independently from `radiusBottom` to build truncated cones; set to `0` to collapse the
   * top ring into an apex.
   * @default 1
   * @example
   * ```ts
   * const bucket = new CylinderGeometry({ radiusTop: 1, radiusBottom: 0.7 });
   * ```
   */
  radiusTop: number;
  /**
   * The radius of the bottom ring (at `-height/2`)
   *
   * Set independently from `radiusTop` to build truncated cones; set to `0` to collapse the
   * bottom ring into an apex.
   * @default 1
   * @example
   * ```ts
   * const lampshade = new CylinderGeometry({ radiusTop: 0.4, radiusBottom: 1, openEnded: true });
   * ```
   */
  radiusBottom: number;
  /**
   * The total height of the cylinder along the Y axis
   *
   * The mesh is centered on the origin, so the top sits at `+height/2` and the bottom at `-height/2`.
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
   *
   * A ring with a radius of `0` never gets a cap.
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
 * `radiusTop` and `radiusBottom` are independent, so the same primitive covers cylinders,
 * truncated cones, and (with one radius set to `0`) cones.
 *
 * The side's normals are smooth and follow the slope between the two radii. Its UVs wrap once
 * around the circumference (`u` from 0 to 1), and `v` runs from 0 at the top to 1 at the bottom.
 * End caps are added unless `openEnded` is `true`; a cap's UVs map it onto the circle inscribed in
 * the texture.
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
 * @see {@link Geometry3D} For the base geometry class
 * @see {@link Geometry3DOptions} For inherited geometry options
 * @see {@link ConeGeometry} For a cylinder with `radiusTop = 0`
 * @see {@link CapsuleGeometry} For a cylinder with hemispherical caps
 * @category geometry
 * @standard
 */
export class CylinderGeometry extends Geometry3D {
  /**
   * Default options for {@link CylinderGeometry}
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
