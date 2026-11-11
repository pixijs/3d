import { Box } from '../math/shapes/Box';
import { Vector3 } from '../math/vector/Vector3';
import { Geometry3D } from './Geometry3D';
import type { Geometry3DOptions } from './Geometry3D';
import { clampSegments } from './utils/clampSegments';

/**
 * Options for {@link CubeGeometry}
 * @example
 * ```ts
 * const options: Partial<CubeGeometryOptions> = { width: 2, height: 1, depth: 1 };
 * const brick = new CubeGeometry(options);
 * ```
 * @category geometry
 * @standard
 */
export interface CubeGeometryOptions extends Geometry3DOptions {
  /**
   * The full extent of the cube along the local X axis
   * @default 1
   * @example
   * ```ts
   * const plank = new CubeGeometry({ width: 4, height: 0.1 });
   * ```
   */
  width: number;
  /**
   * The full extent of the cube along the local Y axis
   * @default 1
   * @example
   * ```ts
   * const pillar = new CubeGeometry({ height: 5 });
   * ```
   */
  height: number;
  /**
   * The full extent of the cube along the local Z axis
   * @default 1
   * @example
   * ```ts
   * const wall = new CubeGeometry({ width: 10, height: 3, depth: 0.2 });
   * ```
   */
  depth: number;
  /**
   * Subdivision count along the X axis; applied to the front, back, top and bottom faces
   *
   * Floored, and clamped to a minimum of 1.
   * @default 1
   * @example
   * ```ts
   * const ribbed = new CubeGeometry({ width: 4, widthSegments: 16 });
   * ```
   */
  widthSegments: number;
  /**
   * Subdivision count along the Y axis; applied to the front, back, left and right faces
   *
   * Floored, and clamped to a minimum of 1.
   * @default 1
   * @example
   * ```ts
   * const tower = new CubeGeometry({ height: 8, heightSegments: 8 });
   * ```
   */
  heightSegments: number;
  /**
   * Subdivision count along the Z axis; applied to the top, bottom, left and right faces
   *
   * Floored, and clamped to a minimum of 1.
   * @default 1
   * @example
   * ```ts
   * const corridor = new CubeGeometry({ depth: 20, depthSegments: 20 });
   * ```
   */
  depthSegments: number;
}

/**
 * A box geometry with six axis-aligned faces, centered on the origin
 *
 * Faces share no vertices, so the edges light hard. Each face's UVs run from (0, 0) at its
 * bottom-left to (1, 1) at its top-right. As on a default {@link PlaneGeometry}, `v` grows upward,
 * so an image texture shows upside down on the side faces.
 * @example
 * ```ts
 * const cube = new CubeGeometry({
 *   width: 1,
 *   height: 1,
 *   depth: 1,
 *   widthSegments: 1,
 *   heightSegments: 1,
 *   depthSegments: 1,
 * });
 * ```
 * @category geometry
 * @standard
 */
export class CubeGeometry extends Geometry3D {
  /**
   * Defaults for every new `CubeGeometry`
   * @example
   * ```ts
   * CubeGeometry.defaultOptions.width = 2;
   * ```
   */
  public static defaultOptions: CubeGeometryOptions = {
    ...Geometry3D.defaultOptions,
    width: 1,
    height: 1,
    depth: 1,
    widthSegments: 1,
    heightSegments: 1,
    depthSegments: 1,
  };

  /**
   * Creates a new `CubeGeometry`
   * @param options - See {@link CubeGeometryOptions} for available options
   */
  constructor(options: Partial<CubeGeometryOptions> = {}) {
    const resolvedOptions = {
      ...CubeGeometry.defaultOptions,
      ...options,
    };
    const { width, height, depth } = resolvedOptions;
    const widthSegments = clampSegments(resolvedOptions.widthSegments, 1);
    const heightSegments = clampSegments(resolvedOptions.heightSegments, 1);
    const depthSegments = clampSegments(resolvedOptions.depthSegments, 1);

    const halfW = width / 2;
    const halfH = height / 2;
    const halfD = depth / 2;

    const vertCount =
      2 * ((widthSegments + 1) * (heightSegments + 1)) +
      2 * ((widthSegments + 1) * (depthSegments + 1)) +
      2 * ((depthSegments + 1) * (heightSegments + 1));
    const idxCount =
      2 * (widthSegments * heightSegments * 6) +
      2 * (widthSegments * depthSegments * 6) +
      2 * (depthSegments * heightSegments * 6);

    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const indices = vertCount <= 65536 ? new Uint16Array(idxCount) : new Uint32Array(idxCount);

    const offsets = { pos: 0, nrm: 0, uv: 0, idx: 0, vert: 0 };

    const addFace = (corners: number[][], nx: number, ny: number, nz: number, segmentsX: number, segmentsY: number) => {
      const startIndex = offsets.vert;
      const rowSize = segmentsX + 1;

      const c00x = corners[0][0];
      const c00y = corners[0][1];
      const c00z = corners[0][2];
      const c10x = corners[1][0];
      const c10y = corners[1][1];
      const c10z = corners[1][2];
      const c11x = corners[2][0];
      const c11y = corners[2][1];
      const c11z = corners[2][2];
      const c01x = corners[3][0];
      const c01y = corners[3][1];
      const c01z = corners[3][2];

      let posOffset = offsets.pos;
      let nrmOffset = offsets.nrm;
      let uvOffset = offsets.uv;

      for (let y = 0; y <= segmentsY; y++) {
        const v = y / segmentsY;
        const leftX = c00x + (c01x - c00x) * v;
        const leftY = c00y + (c01y - c00y) * v;
        const leftZ = c00z + (c01z - c00z) * v;
        const rightX = c10x + (c11x - c10x) * v;
        const rightY = c10y + (c11y - c10y) * v;
        const rightZ = c10z + (c11z - c10z) * v;

        for (let x = 0; x <= segmentsX; x++) {
          const u = x / segmentsX;

          positions[posOffset++] = leftX + (rightX - leftX) * u;
          positions[posOffset++] = leftY + (rightY - leftY) * u;
          positions[posOffset++] = leftZ + (rightZ - leftZ) * u;

          normals[nrmOffset++] = nx;
          normals[nrmOffset++] = ny;
          normals[nrmOffset++] = nz;

          uvs[uvOffset++] = u;
          uvs[uvOffset++] = v;
        }
      }

      offsets.pos = posOffset;
      offsets.nrm = nrmOffset;
      offsets.uv = uvOffset;
      offsets.vert = startIndex + rowSize * (segmentsY + 1);

      let idxOffset = offsets.idx;
      for (let y = 0; y < segmentsY; y++) {
        const rowOffset0 = startIndex + y * rowSize;
        const rowOffset1 = rowOffset0 + rowSize;

        for (let x = 0; x < segmentsX; x++) {
          const a = rowOffset0 + x;
          const b = a + 1;
          const d = rowOffset1 + x;
          const c = d + 1;

          indices[idxOffset++] = a;
          indices[idxOffset++] = b;
          indices[idxOffset++] = c;
          indices[idxOffset++] = a;
          indices[idxOffset++] = c;
          indices[idxOffset++] = d;
        }
      }
      offsets.idx = idxOffset;
    };

    addFace(
      [
        [-halfW, -halfH, halfD],
        [halfW, -halfH, halfD],
        [halfW, halfH, halfD],
        [-halfW, halfH, halfD],
      ],
      0,
      0,
      1,
      widthSegments,
      heightSegments,
    );

    addFace(
      [
        [halfW, -halfH, -halfD],
        [-halfW, -halfH, -halfD],
        [-halfW, halfH, -halfD],
        [halfW, halfH, -halfD],
      ],
      0,
      0,
      -1,
      widthSegments,
      heightSegments,
    );

    addFace(
      [
        [-halfW, halfH, halfD],
        [halfW, halfH, halfD],
        [halfW, halfH, -halfD],
        [-halfW, halfH, -halfD],
      ],
      0,
      1,
      0,
      widthSegments,
      depthSegments,
    );

    addFace(
      [
        [-halfW, -halfH, -halfD],
        [halfW, -halfH, -halfD],
        [halfW, -halfH, halfD],
        [-halfW, -halfH, halfD],
      ],
      0,
      -1,
      0,
      widthSegments,
      depthSegments,
    );

    addFace(
      [
        [halfW, -halfH, halfD],
        [halfW, -halfH, -halfD],
        [halfW, halfH, -halfD],
        [halfW, halfH, halfD],
      ],
      1,
      0,
      0,
      depthSegments,
      heightSegments,
    );

    addFace(
      [
        [-halfW, -halfH, -halfD],
        [-halfW, -halfH, halfD],
        [-halfW, halfH, halfD],
        [-halfW, halfH, -halfD],
      ],
      -1,
      0,
      0,
      depthSegments,
      heightSegments,
    );

    const bounds3D =
      resolvedOptions.bounds3D ?? new Box(new Vector3(-halfW, -halfH, -halfD), new Vector3(halfW, halfH, halfD));

    super({
      ...resolvedOptions,
      bounds3D,
      positions,
      normals,
      uvs,
      indices,
    });
  }
}
