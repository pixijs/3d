import { Geometry3D } from './Geometry3D';
import type { Geometry3DOptions } from './Geometry3D';
import { buildCylinderBuffers } from './utils/buildCylinderBuffers';

/**
 * Options for {@link CylinderGeometry}
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
   */
  radiusTop: number;
  /**
   * The radius of the bottom ring (at `-height/2`)
   *
   * Set independently from `radiusTop` to build truncated cones; set to `0` to collapse the
   * bottom ring into an apex.
   * @default 1
   */
  radiusBottom: number;
  /**
   * The total height of the cylinder along the Y axis
   *
   * The mesh is centered on the origin, so the top sits at `+height/2` and the bottom at `-height/2`.
   * @default 2
   */
  height: number;
  /**
   * The number of segments around the circumference
   *
   * Clamped to a minimum of 3; fewer would collapse the ring into a degenerate shape.
   * @default 32
   */
  radialSegments: number;
  /**
   * The number of segments along the height
   *
   * Clamped to a minimum of 1.
   * @default 1
   */
  heightSegments: number;
  /**
   * When `true`, the end caps are skipped and only the side surface is generated
   *
   * Caps that would collapse to a point (when their radius is `0`) are skipped regardless.
   * @default false
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
 * The side surface uses smooth normals derived from the slope between the two radii; UVs wrap once
 * around the circumference (`u` in `[0, 1]`) and run from bottom to top (`v` in `[0, 1]`). End caps
 * are added unless `openEnded` is `true`; cap UVs are radial inside the unit disk.
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
  /** Default options for {@link CylinderGeometry} */
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
