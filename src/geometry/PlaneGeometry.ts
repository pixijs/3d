import { NOOP } from 'pixi.js';

import { Geometry3D } from './Geometry3D';
import type { Geometry3DOptions } from './Geometry3D';
import { clampSegments } from './utils/clampSegments';

/**
 * Options for {@link PlaneGeometry}
 * @example
 * ```ts
 * const options: Partial<PlaneGeometryOptions> = { width: 16, height: 9, flipV: true };
 * const screen = new PlaneGeometry(options);
 * ```
 * @category geometry
 * @standard
 */
export interface PlaneGeometryOptions extends Geometry3DOptions {
  /**
   * The width of the plane along the local X axis
   * @default 1
   * @example
   * ```ts
   * const banner = new PlaneGeometry({ width: 4, height: 1 });
   * ```
   */
  width: number;
  /**
   * The height of the plane along the local Y axis
   * @default 1
   * @example
   * ```ts
   * const poster = new PlaneGeometry({ width: 2, height: 3, flipV: true });
   * ```
   */
  height: number;
  /**
   * Subdivision count along the width (X axis)
   *
   * Floored, and clamped to a minimum of 1.
   * @default 1
   * @example
   * ```ts
   * const water = new PlaneGeometry({ width: 50, height: 50, widthSegments: 128, heightSegments: 128 });
   * ```
   */
  widthSegments: number;
  /**
   * Subdivision count along the height (Y axis)
   *
   * Floored, and clamped to a minimum of 1.
   * @default 1
   * @example
   * ```ts
   * const flag = new PlaneGeometry({ width: 3, height: 2, widthSegments: 30, heightSegments: 20 });
   * ```
   */
  heightSegments: number;
  /**
   * Put `v = 0` on the top edge instead of the bottom, so an image texture shows the right way up
   *
   * Set it when the plane shows a picture, which otherwise renders upside down. Only the UVs change.
   * @default false
   * @example
   * ```ts
   * const photo = new PlaneGeometry({ width: 4, height: 3, flipV: true });
   * ```
   */
  flipV: boolean;
}

/**
 * A flat plane geometry in the XY plane, centered on the origin and facing +Z
 *
 * Seen from behind it's culled, unless the material is `doubleSided`. UV (0, 0) sits at the
 * bottom-left corner and (1, 1) at the top-right; set `flipV` for an image texture. Subdivide it
 * with `widthSegments` and `heightSegments` when a vertex shader displaces the surface, as for
 * terrain, water or cloth.
 * @example
 * ```ts
 * const plane = new PlaneGeometry({
 *   width: 10,
 *   height: 10,
 *   widthSegments: 32,
 *   heightSegments: 32,
 * });
 * ```
 * @see {@link PlaneGeometry.spriteQuad} For a shared 1×1 quad set up for images
 * @category geometry
 * @standard
 */
export class PlaneGeometry extends Geometry3D {
  /**
   * Defaults for every new `PlaneGeometry`
   * @example
   * ```ts
   * PlaneGeometry.defaultOptions.flipV = true;
   * ```
   */
  public static defaultOptions: PlaneGeometryOptions = {
    ...Geometry3D.defaultOptions,
    width: 1,
    height: 1,
    widthSegments: 1,
    heightSegments: 1,
    flipV: false,
  };

  /** Built on first read, so importing the module builds nothing */
  private static _spriteQuad: PlaneGeometry | null = null;

  /**
   * The shared 1×1 quad every {@link Sprite3D} draws, built as `new PlaneGeometry({ flipV: true })`
   *
   * Give it to {@link BatchedMesh3D} slots with a `billboardMode` to draw billboards without a scene
   * node per sprite. Its `destroy` does nothing, as with pixi's `Texture.WHITE`, so no `destroy`
   * call can pull it out from under the sprites.
   * @example
   * ```ts
   * const sprites = new BatchedMesh3D({ size: 10_000, parent: view.root });
   * sprites.setGeometryAt(0, PlaneGeometry.spriteQuad);
   * sprites.items[0].billboardMode = 'spherical';
   * ```
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
