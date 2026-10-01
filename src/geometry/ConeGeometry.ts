import { Geometry3D } from './Geometry3D';
import type { Geometry3DOptions } from './Geometry3D';
import { buildCylinderBuffers } from './utils/buildCylinderBuffers';

/**
 * Options for {@link ConeGeometry}
 * @example
 * ```ts
 * const options: Partial<ConeGeometryOptions> = { radius: 0.5, height: 1 };
 * const cone = new ConeGeometry(options);
 * ```
 * @category geometry
 * @standard
 */
export interface ConeGeometryOptions extends Geometry3DOptions {
  /**
   * The radius of the base ring (at `-height/2`)
   * @default 1
   * @example
   * ```ts
   * const wide = new ConeGeometry({ radius: 2 });
   * ```
   */
  radius: number;
  /**
   * The total height of the cone along the Y axis
   *
   * The mesh is centered on the origin, so the apex sits at `+height/2` and the base at `-height/2`.
   * @default 2
   * @example
   * ```ts
   * const spike = new ConeGeometry({ radius: 0.2, height: 3 });
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
   * const pyramid = new ConeGeometry({ radialSegments: 4 });
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
   * const bendable = new ConeGeometry({ heightSegments: 8 });
   * ```
   */
  heightSegments: number;
  /**
   * When `true`, the base cap is skipped and only the side surface is generated
   *
   * The apex never has a cap.
   * @default false
   * @example
   * ```ts
   * const funnel = new ConeGeometry({ openEnded: true });
   * ```
   */
  openEnded: boolean;
}

/**
 * A cone geometry oriented along the +Y axis and centered on the origin, with the apex at
 * `+height/2` and the base ring at `-height/2`
 *
 * It is a {@link CylinderGeometry} with a top radius of 0: the apex is the top ring collapsed to a
 * point, so only the base gets a cap.
 *
 * Side normals are smooth and follow the slope. UVs wrap once around the circumference (`u` from
 * 0 to 1), and `v` runs from 0 at the apex to 1 at the base.
 * @example
 * ```ts
 * const cone = new ConeGeometry({
 *   radius: 1,
 *   height: 2,
 *   radialSegments: 32,
 *   heightSegments: 1,
 *   openEnded: false,
 * });
 * ```
 * @see {@link Geometry3D} For the base geometry class
 * @see {@link Geometry3DOptions} For inherited geometry options
 * @see {@link CylinderGeometry} The underlying primitive; a cone is a cylinder with `radiusTop = 0`
 * @see {@link CapsuleGeometry} For a cylinder with hemispherical caps
 * @category geometry
 * @standard
 */
export class ConeGeometry extends Geometry3D {
  /**
   * Default options for {@link ConeGeometry}
   * @example
   * ```ts
   * ConeGeometry.defaultOptions.radialSegments = 16;
   * ```
   */
  public static defaultOptions: ConeGeometryOptions = {
    ...Geometry3D.defaultOptions,
    radius: 1,
    height: 2,
    radialSegments: 32,
    heightSegments: 1,
    openEnded: false,
  };

  /**
   * Creates a new `ConeGeometry`
   * @param options - See {@link ConeGeometryOptions} for available options
   */
  constructor(options: Partial<ConeGeometryOptions> = {}) {
    const resolvedOptions = {
      ...ConeGeometry.defaultOptions,
      ...options,
    };
    const { radius, height, radialSegments, heightSegments, openEnded } = resolvedOptions;
    const buffers = buildCylinderBuffers(0, radius, height, radialSegments, heightSegments, openEnded);

    super({
      ...resolvedOptions,
      ...buffers,
    });
  }
}
