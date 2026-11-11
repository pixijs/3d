import { Geometry3D } from './Geometry3D';
import type { Geometry3DOptions } from './Geometry3D';

/**
 * Options for {@link IcosahedronGeometry}
 * @example
 * ```ts
 * const options: Partial<IcosahedronGeometryOptions> = { radius: 2, detail: 3 };
 * const planet = new IcosahedronGeometry(options);
 * ```
 * @category geometry
 * @standard
 */
export interface IcosahedronGeometryOptions extends Geometry3DOptions {
  /**
   * The radius of the circumscribed sphere
   * @default 1
   * @example
   * ```ts
   * const gem = new IcosahedronGeometry({ radius: 0.25 });
   * ```
   */
  radius: number;
  /**
   * The subdivision level
   *
   * `0` is the bare 20-face icosahedron, and each step quadruples the face count. The geometry has
   * `10 * 4^detail + 2` vertices. Floored and clamped to 0 to 7, where 7 gives 163842 vertices; a
   * value that isn't finite counts as 0.
   * @default 0
   * @example
   * ```ts
   * const smooth = new IcosahedronGeometry({ detail: 3 });
   * ```
   */
  detail: number;
}

/** Keeps every vertex index below `0x100000`, which the midpoint cache key needs */
const MAX_DETAIL = 7;

/**
 * An icosahedron geometry, the 20-faced regular polyhedron
 *
 * Raising `detail` makes a geodesic sphere with near-uniform faces, without the pinched poles of a
 * UV sphere. Normals point straight out from the center. UVs are equirectangular:
 * `u = 0.5 + atan2(nz, nx) / (2π)`, `v = 0.5 - asin(ny) / π`.
 * The vertices along the seam where `u` wraps from 1 back to 0 are shared, so the triangles that
 * cross it squeeze the whole texture into one strip. Use {@link SphereGeometry} for a textured
 * sphere.
 * @example
 * ```ts
 * const icosahedron = new IcosahedronGeometry({ radius: 1, detail: 0 });
 * const geodesicSphere = new IcosahedronGeometry({ radius: 1, detail: 2 });
 * ```
 * @category geometry
 * @standard
 */
export class IcosahedronGeometry extends Geometry3D {
  /**
   * Defaults for every new `IcosahedronGeometry`
   * @example
   * ```ts
   * IcosahedronGeometry.defaultOptions.detail = 2;
   * ```
   */
  public static defaultOptions: IcosahedronGeometryOptions = {
    ...Geometry3D.defaultOptions,
    radius: 1,
    detail: 0,
  };

  /**
   * Creates a new `IcosahedronGeometry`
   * @param options - See {@link IcosahedronGeometryOptions} for available options
   */
  constructor(options: Partial<IcosahedronGeometryOptions> = {}) {
    const resolvedOptions = {
      ...IcosahedronGeometry.defaultOptions,
      ...options,
    };
    const { radius } = resolvedOptions;
    const rawDetail = resolvedOptions.detail;
    const detail = Number.isFinite(rawDetail) ? Math.max(0, Math.min(MAX_DETAIL, Math.floor(rawDetail))) : 0;

    const t = (1 + Math.sqrt(5)) / 2;

    const baseVertices = [
      -1,
      t,
      0,
      1,
      t,
      0,
      -1,
      -t,
      0,
      1,
      -t,
      0,
      0,
      -1,
      t,
      0,
      1,
      t,
      0,
      -1,
      -t,
      0,
      1,
      -t,
      t,
      0,
      -1,
      t,
      0,
      1,
      -t,
      0,
      -1,
      -t,
      0,
      1,
    ];

    const baseIndices = [
      0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4,
      2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
    ];

    const vertCount = 10 * 4 ** detail + 2;
    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    let vertexCount = 0;

    const pushVertex = (x: number, y: number, z: number): number => {
      const len = Math.sqrt(x * x + y * y + z * z);
      const nx = x / len;
      const ny = y / len;
      const nz = z / len;

      const index = vertexCount;
      const p = index * 3;

      positions[p] = nx * radius;
      positions[p + 1] = ny * radius;
      positions[p + 2] = nz * radius;

      normals[p] = nx;
      normals[p + 1] = ny;
      normals[p + 2] = nz;

      const u = 0.5 + Math.atan2(nz, nx) / (2 * Math.PI);
      const v = 0.5 - Math.asin(ny) / Math.PI;
      const uv = index * 2;
      uvs[uv] = u;
      uvs[uv + 1] = v;

      vertexCount++;
      return index;
    };

    for (let i = 0; i < baseVertices.length; i += 3) {
      pushVertex(baseVertices[i], baseVertices[i + 1], baseVertices[i + 2]);
    }

    const midpointCache = new Map<number, number>();

    const getMidpoint = (i1: number, i2: number): number => {
      const lo = i1 < i2 ? i1 : i2;
      const hi = i1 < i2 ? i2 : i1;
      const key = lo * 0x100000 + hi;
      const cached = midpointCache.get(key);

      if (cached !== undefined) {
        return cached;
      }

      const a = lo * 3;
      const b = hi * 3;
      const x = (positions[a] + positions[b]) / 2;
      const y = (positions[a + 1] + positions[b + 1]) / 2;
      const z = (positions[a + 2] + positions[b + 2]) / 2;

      const index = pushVertex(x, y, z);

      midpointCache.set(key, index);
      return index;
    };

    let faces = new Uint32Array(baseIndices.length);

    for (let i = 0; i < baseIndices.length; i++) {
      faces[i] = baseIndices[i];
    }

    let faceCount = baseIndices.length / 3;

    for (let d = 0; d < detail; d++) {
      const newFaces = new Uint32Array(faceCount * 4 * 3);
      let writeOffset = 0;

      for (let f = 0; f < faceCount; f++) {
        const readOffset = f * 3;
        const a = faces[readOffset];
        const b = faces[readOffset + 1];
        const c = faces[readOffset + 2];

        const ab = getMidpoint(a, b);
        const bc = getMidpoint(b, c);
        const ca = getMidpoint(c, a);

        newFaces[writeOffset] = a;
        newFaces[writeOffset + 1] = ab;
        newFaces[writeOffset + 2] = ca;

        newFaces[writeOffset + 3] = b;
        newFaces[writeOffset + 4] = bc;
        newFaces[writeOffset + 5] = ab;

        newFaces[writeOffset + 6] = c;
        newFaces[writeOffset + 7] = ca;
        newFaces[writeOffset + 8] = bc;

        newFaces[writeOffset + 9] = ab;
        newFaces[writeOffset + 10] = bc;
        newFaces[writeOffset + 11] = ca;

        writeOffset += 12;
      }

      faces = newFaces;
      faceCount *= 4;
    }

    const indexCount = faceCount * 3;
    const indices = vertexCount > 65536 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);

    for (let i = 0; i < indexCount; i++) {
      indices[i] = faces[i];
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
