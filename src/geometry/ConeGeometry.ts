import { Geometry3D } from './Geometry3D';
import type { Geometry3DOptions } from './Geometry3D';
import { buildCylinderBuffers } from './utils/buildCylinderBuffers';

/**
 * Options for {@link ConeGeometry}
 * @category geometry
 * @standard
 */
export interface ConeGeometryOptions extends Geometry3DOptions {
  /**
   * The radius of the base ring (at `-height/2`)
   * @default 1
   */
  radius: number;
  /**
   * The total height of the cone along the Y axis
   *
   * The mesh is centered on the origin, so the apex sits at `+height/2` and the base at `-height/2`.
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
   * When `true`, the base cap is skipped and only the side surface is generated
   *
   * The apex is always a collapsed ring with no cap regardless of this flag.
   * @default false
   */
  openEnded: boolean;
}

/**
 * A cone geometry oriented along the +Y axis and centered on the origin, with the apex at
 * `+height/2` and the base ring at `-height/2`
 *
 * Implemented by passing `radiusTop = 0` to the shared cylinder builder, so only the bottom cap
 * is generated; the apex is just the top ring collapsed to a point.
 *
 * Side normals are smooth and slope-aware; UVs wrap once around the circumference (`u` in
 * `[0, 1]`) and run from base to apex (`v` in `[0, 1]`).
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
  /** Default options for {@link ConeGeometry} */
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
