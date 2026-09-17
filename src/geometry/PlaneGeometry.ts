import { NOOP } from 'pixi.js';

import { Geometry3D } from './Geometry3D';
import type { Geometry3DOptions } from './Geometry3D';
import { clampSegments } from './utils/clampSegments';

/**
 * Options for {@link PlaneGeometry}
 * @category geometry
 * @standard
 */
export interface PlaneGeometryOptions extends Geometry3DOptions {
  /**
   * The width of the plane along the local X axis
   * @default 1
   */
  width: number;
  /**
   * The height of the plane along the local Y axis
   * @default 1
   */
  height: number;
  /**
   * Subdivision count along the width (X axis); the plane is split into this many quads horizontally
   * @default 1
   */
  widthSegments: number;
  /**
   * Subdivision count along the height (Y axis); the plane is split into this many quads vertically
   * @default 1
   */
  heightSegments: number;
  /**
   * Put `v = 0` on the top edge instead of the bottom, i.e. image orientation
   *
   * Image formats address rows top-down while the default UVs run v-up, so an
   * image texture mapped onto a plane renders upside-down. Set this when the
   * plane is a surface for a picture rather than for a tiling or procedural
   * material.
   *
   * Only the UVs change — positions, normals and winding are untouched.
   * @default false
   */
  flipV: boolean;
}

/**
 * A flat, single-sided plane geometry built on a regular grid of vertices
 *
 * The plane lies in the XY plane, centered on the origin, with a uniform `+Z` normal on every vertex.
 * UV (0, 0) sits at the bottom-left corner `(-w/2, -h/2, 0)` and UV (1, 1) at the top-right `(+w/2, +h/2, 0)`;
 * pass `flipV` to put `v = 0` on the top edge instead, which is what an image texture expects.
 * Subdivide via `widthSegments` and `heightSegments` for vertex shaders that displace the surface (terrain,
 * water, cloth) where the extra vertex density matters.
 * @example
 * ```ts
 * const plane = new PlaneGeometry({
 *   width: 10,
 *   height: 10,
 *   widthSegments: 32,
 *   heightSegments: 32,
 * });
 * ```
 * @see {@link PlaneGeometry.spriteQuad} For the shared image-oriented 1×1 quad
 * @see {@link Geometry3D} For the base geometry class
 * @see {@link Geometry3DOptions} For inherited geometry options
 * @category geometry
 * @standard
 */
export class PlaneGeometry extends Geometry3D {
  /** Default options for {@link PlaneGeometry} */
  public static defaultOptions: PlaneGeometryOptions = {
    ...Geometry3D.defaultOptions,
    width: 1,
    height: 1,
    widthSegments: 1,
    heightSegments: 1,
    flipV: false,
  };

  /** Backing store for {@link PlaneGeometry.spriteQuad}, built on first read */
  private static _spriteQuad: PlaneGeometry | null = null;

  /**
   * The shared 1×1 image-oriented quad — `new PlaneGeometry({ flipV: true })`,
   * built once and reused process-wide. What every {@link Sprite3D} draws, and
   * the geometry to hand a {@link BatchedMesh3D} slot when driving billboards
   * without per-sprite scene nodes.
   *
   * One geometry for every sprite is the point. The batcher keys draws on
   * pipeline plus geometry uid, so same-mode sprites — however many distinct
   * textures and tints they carry — collapse into a single instanced draw.
   *
   * Its `destroy` is a no-op, the same guard pixi puts on `Texture.EMPTY` /
   * `Texture.WHITE`, so no path — user code, `sprite.destroy(true)`, a
   * scene-wide geometry sweep — can tear the quad out from under every other
   * sprite in the process. A getter rather than a field so nothing is built at
   * import time.
   * @see {@link Sprite3D} For the managed node that draws this quad.
   */
  public static get spriteQuad(): PlaneGeometry {
    return (PlaneGeometry._spriteQuad ??= (() => {
      const quad = new PlaneGeometry({ flipV: true });
      quad.destroy = NOOP;
      return quad;
    })());
  }

  /**
   * Creates a new `PlaneGeometry`
   * @param options - See {@link PlaneGeometryOptions} for available options
   */
  constructor(options: Partial<PlaneGeometryOptions> = {}) {
    const resolvedOptions = {
      ...PlaneGeometry.defaultOptions,
      ...options,
    };
    const { width, height, flipV } = resolvedOptions;
    const widthSegments = clampSegments(resolvedOptions.widthSegments, 1);
    const heightSegments = clampSegments(resolvedOptions.heightSegments, 1);

    const vertCount = (widthSegments + 1) * (heightSegments + 1);
    const triCount = widthSegments * heightSegments * 2;

    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const indices = vertCount > 65536 ? new Uint32Array(triCount * 3) : new Uint16Array(triCount * 3);

    const halfW = width * 0.5;
    const halfH = height * 0.5;
    const invW = 1 / widthSegments;
    const invH = 1 / heightSegments;

    let pi = 0;
    let ni = 0;
    let ui = 0;

    for (let y = 0; y <= heightSegments; ++y) {
      const v = y * invH;

      for (let x = 0; x <= widthSegments; ++x) {
        const u = x * invW;

        positions[pi++] = u * width - halfW;
        positions[pi++] = v * height - halfH;
        positions[pi++] = 0;

        normals[ni++] = 0;
        normals[ni++] = 0;
        normals[ni++] = 1;

        uvs[ui++] = u;
        uvs[ui++] = flipV ? 1 - v : v;
      }
    }

    const rowSize = widthSegments + 1;
    let ii = 0;

    for (let y = 0; y < heightSegments; ++y) {
      const rowOffset0 = (y + 0) * rowSize;
      const rowOffset1 = (y + 1) * rowSize;

      for (let x = 0; x < widthSegments; ++x) {
        const offset0 = rowOffset0 + x;
        const offset1 = rowOffset1 + x;

        indices[ii++] = offset0;
        indices[ii++] = offset0 + 1;
        indices[ii++] = offset1;

        indices[ii++] = offset1;
        indices[ii++] = offset0 + 1;
        indices[ii++] = offset1 + 1;
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
