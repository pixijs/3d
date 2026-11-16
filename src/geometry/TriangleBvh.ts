import { Box } from '../math/shapes/Box';
import type { Ray } from '../math/shapes/Ray';
import type { Sphere } from '../math/shapes/Sphere';
import type { PointData3D } from '../math/vector/PointData3D';
import type { Vector3 } from '../math/vector/Vector3';

/** Most triangles a leaf holds */
const LEAF_SIZE = 4;
/**
 * Nodes with more triangles than this split where the surface area heuristic says rays cost least; smaller ones
 * split along the Morton order, which needs no pass over their triangles
 */
const SAH_MIN_TRIANGLES = 128;
const BINS = 16;
/** `raycast` inlines its triangle test for speed, as does `intersectRayGeometry`; keep the two copies in step */
const EPSILON = 1e-7;
/** Widens a box's exit distance by its rounding error, so a ray along the edge of a zero-thickness box still enters */
const EXIT_SCALE = 1.0000000000000007;

const buckets = new Uint32Array(1024);
const binCounts = new Uint32Array(BINS);
/** Six per bin: the min xyz then max xyz of its triangles' boxes */
const binBounds = new Float64Array(BINS * 6);
const leftAreas = new Float64Array(BINS);
let stack = new Int32Array(64);
/** The entry distance of each node on `stack`, so a pop compares it with the closest hit instead of testing again */
let stackEntries = new Float64Array(64);
/** The slot in `_tris` of the point `_nearest` found last */
let nearestSlot = 0;
/** That point's u and v weights, then its x, y and z */
const nearest = new Float64Array(5);
/** A stack and a box per `traverse` nesting depth, since its callbacks may start another walk */
const walkStacks: Int32Array[] = [];
const walkBoxes: Box[] = [];
let walkDepth = 0;

function growStack(): void {
  const grown = new Int32Array(stack.length * 2);
  grown.set(stack);
  stack = grown;
  const grownEntries = new Float64Array(stackEntries.length * 2);
  grownEntries.set(stackEntries);
  stackEntries = grownEntries;
}

function spreadBits(v: number): number {
  v = (v | (v << 16)) & 0x030000ff;
  v = (v | (v << 8)) & 0x0300f00f;
  v = (v | (v << 4)) & 0x030c30c3;
  return (v | (v << 2)) & 0x09249249;
}

/**
 * A bounding volume hierarchy (BVH) over a triangle list: nested boxes around groups of triangles, so a
 * ray tests the few dozen triangles near it instead of all of them
 *
 * Read one from {@link Geometry3D#bvh | geometry.bvh} rather than constructing it: the geometry builds it once,
 * then refits or replaces it on the calls that getter lists. A hierarchy holds the arrays it was built from and
 * doesn't notice edits to them until {@link TriangleBvh#update | update}.
 * @example
 * ```ts
 * const localToWorld = terrain.getGlobalTransform();
 * const localRay = worldRay.applyMatrix4(new Matrix4().getInverse(localToWorld), new Ray());
 * const distance = terrain.geometry.bvh?.raycast(localRay) ?? -1;
 *
 * if (distance >= 0) marker.position.copyFrom(localRay.at(distance).applyAffineMatrix4(localToWorld));
 * ```
 * @category geometry
 * @advanced
 */
export class TriangleBvh {
  /**
   * The triangle the last {@link TriangleBvh#raycast} or {@link TriangleBvh#closestPointToPoint} found; `-1` after
   * a miss
   *
   * Triangle `n` is the three vertices the index array lists at `3 * n` to `3 * n + 2`, or, without indices,
   * vertices `3 * n` to `3 * n + 2`.
   */
  public triangle = -1;
  /**
   * Weight of the hit triangle's second vertex at the last hit; the first vertex's is `1 - u - v`
   *
   * To get a UV or normal at the hit, add up the three vertices' values, each times its weight.
   */
  public u = 0;
  /** Weight of the hit triangle's third vertex at the last hit */
  public v = 0;

  /** @internal */
  public readonly _positions: Float32Array;
  /** @internal */
  public readonly _indices: Uint16Array | Uint32Array | null;

  /**
   * A 32-byte record per node: min xyz and max xyz, then `first` and `count` read through `_links`. A leaf holds
   * `count` triangles from `_tris[first]`; an inner node has `count` 0 and its children at `first` and `first + 1`.
   */
  private _bounds: Float32Array;
  /** `_bounds`'s buffer read as integers */
  private _links: Uint32Array;
  private _nodeCount = 0;
  /** Triangle numbers, ordered so each node's are contiguous */
  private readonly _tris: Uint32Array;

  /**
   * Builds the hierarchy, which takes time in proportion to the triangle count
   * @param positions - Vertex positions, three numbers per vertex
   * @param indices - Vertex numbers, three per triangle, or `null` when every three vertices in order make a triangle
   */
  constructor(positions: Float32Array, indices: Uint16Array | Uint32Array | null) {
    this._positions = positions;
    this._indices = indices;
    const count = Math.floor(indices ? indices.length / 3 : positions.length / 9);
    const boxes = new Float32Array(count * 6);
    const centroids = new Float32Array(count * 3);

    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
      const i0 = (indices ? indices[i * 3] : i * 3) * 3;
      const i1 = (indices ? indices[i * 3 + 1] : i * 3 + 1) * 3;
      const i2 = (indices ? indices[i * 3 + 2] : i * 3 + 2) * 3;
      for (let k = 0; k < 3; k++) {
        const low = Math.min(positions[i0 + k], positions[i1 + k], positions[i2 + k]);
        const high = Math.max(positions[i0 + k], positions[i1 + k], positions[i2 + k]);
        boxes[i * 6 + k] = low;
        boxes[i * 6 + 3 + k] = high;
        centroids[i * 3 + k] = (low + high) * 0.5;
      }
      minX = Math.min(minX, centroids[i * 3]);
      minY = Math.min(minY, centroids[i * 3 + 1]);
      minZ = Math.min(minZ, centroids[i * 3 + 2]);
      maxX = Math.max(maxX, centroids[i * 3]);
      maxY = Math.max(maxY, centroids[i * 3 + 1]);
      maxZ = Math.max(maxZ, centroids[i * 3 + 2]);
    }

    const scaleX = maxX > minX ? 1023.99 / (maxX - minX) : 0;
    const scaleY = maxY > minY ? 1023.99 / (maxY - minY) : 0;
    const scaleZ = maxZ > minZ ? 1023.99 / (maxZ - minZ) : 0;
    let codes = new Uint32Array(count);
    let tris = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
      const x = ((centroids[i * 3] - minX) * scaleX) | 0;
      const y = ((centroids[i * 3 + 1] - minY) * scaleY) | 0;
      const z = ((centroids[i * 3 + 2] - minZ) * scaleZ) | 0;
      codes[i] = (spreadBits(x) << 2) | (spreadBits(y) << 1) | spreadBits(z);
      tris[i] = i;
    }

    let spareCodes = new Uint32Array(count);
    let spareTris = new Uint32Array(count);
    for (let shift = 0; shift < 30; shift += 10) {
      buckets.fill(0);
      for (let i = 0; i < count; i++) buckets[(codes[i] >>> shift) & 1023]++;
      let sum = 0;
      for (let b = 0; b < 1024; b++) {
        const size = buckets[b];
        buckets[b] = sum;
        sum += size;
      }
      for (let i = 0; i < count; i++) {
        const at = buckets[(codes[i] >>> shift) & 1023]++;
        spareCodes[at] = codes[i];
        spareTris[at] = tris[i];
      }
      [codes, spareCodes] = [spareCodes, codes];
      [tris, spareTris] = [spareTris, tris];
    }
    this._tris = tris;

    this._bounds = new Float32Array(Math.max(1, Math.ceil(count / LEAF_SIZE) * 2) * 8);
    this._links = new Uint32Array(this._bounds.buffer);
    this._split(boxes, centroids, codes, spareCodes, spareTris);
    if (this._nodeCount * 8 < this._bounds.length) {
      this._bounds = this._bounds.slice(0, this._nodeCount * 8);
      this._links = new Uint32Array(this._bounds.buffer);
    }
    this._fitBounds(boxes);
  }

  /**
   * Refits every box to the arrays as they are now, without rebuilding the hierarchy
   *
   * Call it after editing the arrays of a hierarchy you built yourself; {@link Geometry3D#bvh | geometry.bvh} calls it
   * for you after the edits that getter lists. The triangles stay grouped as they were, so after a large deformation
   * queries stay correct but slow down, and {@link Geometry3D#buildBvh | buildBvh} restores their speed.
   */
  public update(): void {
    this._fitBounds(null);
  }

  /**
   * Finds the closest triangle the ray hits, on its front or its back face
   *
   * A hit sets {@link TriangleBvh#triangle}, {@link TriangleBvh#u} and {@link TriangleBvh#v}; a miss sets
   * `triangle` to `-1` and leaves `u` and `v` as they were. The ray goes in the positions' space, which for
   * {@link Geometry3D#bvh | geometry.bvh} is the local space of the mesh that draws the geometry;
   * {@link Ray#applyMatrix4} moves a world ray there.
   * @param ray - The ray, with a unit-length direction
   * @param maxDistance - Ignore hits this far along the ray or farther
   * @returns The distance from the ray's origin to the hit, in the positions' units, or `-1` for a miss.
   */
  public raycast(ray: Ray, maxDistance = Infinity): number {
    if (this._tris.length === 0) {
      this.triangle = -1;
      return -1;
    }
    const ox = ray.origin.x,
      oy = ray.origin.y,
      oz = ray.origin.z;
    const dx = ray.direction.x,
      dy = ray.direction.y,
      dz = ray.direction.z;
    const ix = 1 / dx,
      iy = 1 / dy,
      iz = 1 / dz;
    const positions = this._positions;
    const indices = this._indices;
    const tris = this._tris;
    const bounds = this._bounds;
    const links = this._links;
    let best = maxDistance;
    let bestSlot = -1;
    let bestU = 0;
    let bestV = 0;

    let top = 0;
    stack[top] = 0;
    stackEntries[top++] = 0;
    while (top > 0) {
      const node = stack[--top];
      if (stackEntries[top] >= best) continue;

      const first = links[node * 8 + 6];
      const count = links[node * 8 + 7];
      if (count > 0) {
        for (let slot = first; slot < first + count; slot++) {
          const tri = tris[slot] * 3;
          const a = (indices ? indices[tri] : tri) * 3;
          const b = (indices ? indices[tri + 1] : tri + 1) * 3;
          const c = (indices ? indices[tri + 2] : tri + 2) * 3;
          const ax = positions[a],
            ay = positions[a + 1],
            az = positions[a + 2];
          const e1x = positions[b] - ax,
            e1y = positions[b + 1] - ay,
            e1z = positions[b + 2] - az;
          const e2x = positions[c] - ax,
            e2y = positions[c + 1] - ay,
            e2z = positions[c + 2] - az;
          const hx = dy * e2z - dz * e2y,
            hy = dz * e2x - dx * e2z,
            hz = dx * e2y - dy * e2x;
          const det = e1x * hx + e1y * hy + e1z * hz;
          if (det > -EPSILON && det < EPSILON) continue;
          const f = 1 / det;
          const sx = ox - ax,
            sy = oy - ay,
            sz = oz - az;
          const u = f * (sx * hx + sy * hy + sz * hz);
          if (!(u >= 0 && u <= 1)) continue;
          const qx = sy * e1z - sz * e1y,
            qy = sz * e1x - sx * e1z,
            qz = sx * e1y - sy * e1x;
          const v = f * (dx * qx + dy * qy + dz * qz);
          if (!(v >= 0 && u + v <= 1)) continue;
          const t = f * (e2x * qx + e2y * qy + e2z * qz);
          if (!(t >= EPSILON && t < best)) continue;
          best = t;
          bestSlot = slot;
          bestU = u;
          bestV = v;
        }
        continue;
      }

      if (top + 2 > stack.length) growStack();
      let o = first * 8;
      let x0 = (bounds[o] - ox) * ix,
        x1 = (bounds[o + 3] - ox) * ix;
      let y0 = (bounds[o + 1] - oy) * iy,
        y1 = (bounds[o + 4] - oy) * iy;
      let z0 = (bounds[o + 2] - oz) * iz,
        z1 = (bounds[o + 5] - oz) * iz;
      let enter = Math.max(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), 0);
      let exit = Math.min(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1));
      const near = exit * EXIT_SCALE >= enter ? enter : exit < enter ? Infinity : 0;
      o += 8;
      x0 = (bounds[o] - ox) * ix;
      x1 = (bounds[o + 3] - ox) * ix;
      y0 = (bounds[o + 1] - oy) * iy;
      y1 = (bounds[o + 4] - oy) * iy;
      z0 = (bounds[o + 2] - oz) * iz;
      z1 = (bounds[o + 5] - oz) * iz;
      enter = Math.max(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), 0);
      exit = Math.min(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1));
      const far = exit * EXIT_SCALE >= enter ? enter : exit < enter ? Infinity : 0;

      if (near <= far) {
        if (far < best) {
          stack[top] = first + 1;
          stackEntries[top++] = far;
        }
        if (near < best) {
          stack[top] = first;
          stackEntries[top++] = near;
        }
      } else {
        if (near < best) {
          stack[top] = first;
          stackEntries[top++] = near;
        }
        if (far < best) {
          stack[top] = first + 1;
          stackEntries[top++] = far;
        }
      }
    }

    if (bestSlot < 0) {
      this.triangle = -1;
      return -1;
    }

    this.triangle = tris[bestSlot];
    this.u = bestU;
    this.v = bestV;
    return best;
  }

  /**
   * Finds the point on the triangles closest to `point`, within `maxDistance`
   *
   * A hit sets {@link TriangleBvh#triangle}, {@link TriangleBvh#u} and {@link TriangleBvh#v} as
   * {@link TriangleBvh#raycast} does; a miss sets `triangle` to `-1` and leaves `out`, `u` and `v` as they were.
   * `point` and `out` are in the positions' space.
   * @param point - The point to measure from
   * @param out - Receives the closest point
   * @param maxDistance - Ignore triangles farther than this
   * @returns The distance to the closest point, in the positions' units, or `-1` when no triangle is within
   * `maxDistance`.
   */
  public closestPointToPoint(point: PointData3D, out: Vector3, maxDistance = Infinity): number {
    const squared = this._nearest(point, maxDistance, false);
    if (squared < 0) {
      this.triangle = -1;
      return -1;
    }

    this.triangle = this._tris[nearestSlot];
    this.u = nearest[0];
    this.v = nearest[1];
    out.set(nearest[2], nearest[3], nearest[4]);
    return Math.sqrt(squared);
  }

  /**
   * Whether any triangle touches or lies inside the sphere
   *
   * A sphere wholly inside a closed mesh touches no triangle, so it doesn't count. The sphere is in the positions'
   * space.
   * @param sphere - The sphere to test
   * @returns Whether a triangle lies within `sphere.radius` of its centre.
   */
  public intersectsSphere(sphere: Sphere): boolean {
    return this._nearest(sphere.center, sphere.radius, true) >= 0;
  }

  /**
   * Returns the squared distance to the nearest triangle point within `maxDistance`, or `-1`, and writes that point to
   * the `nearest` scratch; with `anyHit` it stops at the first triangle in range
   */
  private _nearest(point: PointData3D, maxDistance: number, anyHit: boolean): number {
    if (this._tris.length === 0 || maxDistance < 0) return -1;
    const px = point.x,
      py = point.y,
      pz = point.z;
    const positions = this._positions;
    const indices = this._indices;
    const tris = this._tris;
    const bounds = this._bounds;
    const links = this._links;
    let best = maxDistance * maxDistance;
    let bestSlot = -1;
    let bestU = 0,
      bestV = 0,
      bestX = 0,
      bestY = 0,
      bestZ = 0;

    let top = 0;
    stack[top] = 0;
    stackEntries[top++] = 0;
    while (top > 0) {
      const node = stack[--top];
      if (stackEntries[top] > best) continue;

      const first = links[node * 8 + 6];
      const count = links[node * 8 + 7];
      if (count > 0) {
        for (let slot = first; slot < first + count; slot++) {
          const tri = tris[slot] * 3;
          const a = (indices ? indices[tri] : tri) * 3;
          const b = (indices ? indices[tri + 1] : tri + 1) * 3;
          const c = (indices ? indices[tri + 2] : tri + 2) * 3;
          const ax = positions[a],
            ay = positions[a + 1],
            az = positions[a + 2];
          const abx = positions[b] - ax,
            aby = positions[b + 1] - ay,
            abz = positions[b + 2] - az;
          const acx = positions[c] - ax,
            acy = positions[c + 1] - ay,
            acz = positions[c + 2] - az;
          const apx = px - ax,
            apy = py - ay,
            apz = pz - az;
          const d1 = abx * apx + aby * apy + abz * apz;
          const d2 = acx * apx + acy * apy + acz * apz;
          const d3 = d1 - (abx * abx + aby * aby + abz * abz);
          const d4 = d2 - (acx * abx + acy * aby + acz * abz);
          const d5 = d1 - (abx * acx + aby * acy + abz * acz);
          const d6 = d2 - (acx * acx + acy * acy + acz * acz);
          const vc = d1 * d4 - d3 * d2;
          const vb = d5 * d2 - d1 * d6;
          const va = d3 * d6 - d5 * d4;
          let u = 0;
          let v = 0;
          if (d1 <= 0 && d2 <= 0) {
            u = 0;
          } else if (d3 >= 0 && d4 <= d3) {
            u = 1;
          } else if (vc <= 0 && d1 >= 0 && d3 <= 0 && d1 > d3) {
            u = d1 / (d1 - d3);
          } else if (d6 >= 0 && d5 <= d6) {
            v = 1;
          } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            v = d2 / (d2 - d6);
          } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
            v = (d4 - d3) / (d4 - d3 + (d5 - d6));
            u = 1 - v;
          } else {
            const scale = 1 / (va + vb + vc);
            u = vb * scale;
            v = vc * scale;
          }
          const qx = ax + abx * u + acx * v,
            qy = ay + aby * u + acy * v,
            qz = az + abz * u + acz * v;
          const distance = (px - qx) * (px - qx) + (py - qy) * (py - qy) + (pz - qz) * (pz - qz);
          if (!(distance <= best)) continue;
          best = distance;
          bestSlot = slot;
          bestU = u;
          bestV = v;
          bestX = qx;
          bestY = qy;
          bestZ = qz;
          if (anyHit) {
            top = 0;
            break;
          }
        }
        continue;
      }

      if (top + 2 > stack.length) growStack();
      let o = first * 8;
      let gx = Math.max(bounds[o] - px, 0, px - bounds[o + 3]),
        gy = Math.max(bounds[o + 1] - py, 0, py - bounds[o + 4]),
        gz = Math.max(bounds[o + 2] - pz, 0, pz - bounds[o + 5]);
      const near = gx * gx + gy * gy + gz * gz;
      o += 8;
      gx = Math.max(bounds[o] - px, 0, px - bounds[o + 3]);
      gy = Math.max(bounds[o + 1] - py, 0, py - bounds[o + 4]);
      gz = Math.max(bounds[o + 2] - pz, 0, pz - bounds[o + 5]);
      const far = gx * gx + gy * gy + gz * gz;

      if (near <= far) {
        if (!(far > best)) {
          stack[top] = first + 1;
          stackEntries[top++] = far;
        }
        if (!(near > best)) {
          stack[top] = first;
          stackEntries[top++] = near;
        }
      } else {
        if (!(near > best)) {
          stack[top] = first;
          stackEntries[top++] = near;
        }
        if (!(far > best)) {
          stack[top] = first + 1;
          stackEntries[top++] = far;
        }
      }
    }

    if (bestSlot < 0) return -1;

    nearestSlot = bestSlot;
    nearest[0] = bestU;
    nearest[1] = bestV;
    nearest[2] = bestX;
    nearest[3] = bestY;
    nearest[4] = bestZ;
    return best;
  }

  /**
   * Walks the hierarchy, entering the boxes `intersectsBox` accepts and handing each triangle in them to
   * `visitTriangle`
   *
   * Use it for a query the others don't cover, such as every triangle in a region. `intersectsBox` gets one reused
   * box in the positions' space, so read it rather than keep it. Both callbacks may run any query on this or another
   * hierarchy, `traverse` included.
   * @param intersectsBox - Whether to enter a box; `false` skips every triangle inside it
   * @param visitTriangle - Sees each triangle's number, counted as {@link TriangleBvh#triangle} is; `true` stops the
   * walk
   * @returns `true` when `visitTriangle` stopped the walk.
   */
  public traverse(intersectsBox: (box: Box) => boolean, visitTriangle: (triangle: number) => boolean | void): boolean {
    if (this._tris.length === 0) return false;
    const depth = walkDepth++;
    let walk = (walkStacks[depth] ??= new Int32Array(64));
    const box = (walkBoxes[depth] ??= new Box());
    const tris = this._tris;
    const bounds = this._bounds;
    const links = this._links;

    try {
      let top = 0;
      walk[top++] = 0;
      while (top > 0) {
        const o = walk[--top] * 8;
        box.min.set(bounds[o], bounds[o + 1], bounds[o + 2]);
        box.max.set(bounds[o + 3], bounds[o + 4], bounds[o + 5]);
        if (!intersectsBox(box)) continue;

        const first = links[o + 6];
        const count = links[o + 7];
        if (count > 0) {
          for (let slot = first; slot < first + count; slot++) {
            if (visitTriangle(tris[slot]) === true) return true;
          }
          continue;
        }
        if (top + 2 > walk.length) {
          const grown = new Int32Array(walk.length * 2);
          grown.set(walk);
          walk = walkStacks[depth] = grown;
        }
        walk[top++] = first + 1;
        walk[top++] = first;
      }
      return false;
    } finally {
      walkDepth--;
    }
  }

  /**
   * Splits nodes from the root down, keeping each side of a split in Morton order so the codes stay sorted for the
   * Morton splits below `SAH_MIN_TRIANGLES`
   */
  private _split(
    boxes: Float32Array,
    centroids: Float32Array,
    codes: Uint32Array,
    spareCodes: Uint32Array,
    spareTris: Uint32Array,
  ): void {
    const tris = this._tris;
    const binOf = new Uint8Array(tris.length);
    let work = new Uint32Array(96);
    let top = 0;
    work[top++] = this._allocate();
    work[top++] = 0;
    work[top++] = tris.length;

    while (top > 0) {
      const end = work[--top];
      const start = work[--top];
      const node = work[--top];
      const count = end - start;
      if (count <= LEAF_SIZE) {
        this._links[node * 8 + 6] = start;
        this._links[node * 8 + 7] = count;
        continue;
      }

      let middle = -1;
      if (count > SAH_MIN_TRIANGLES) {
        let minX = Infinity,
          minY = Infinity,
          minZ = Infinity;
        let maxX = -Infinity,
          maxY = -Infinity,
          maxZ = -Infinity;
        for (let k = start; k < end; k++) {
          const c = tris[k] * 3;
          minX = Math.min(minX, centroids[c]);
          minY = Math.min(minY, centroids[c + 1]);
          minZ = Math.min(minZ, centroids[c + 2]);
          maxX = Math.max(maxX, centroids[c]);
          maxY = Math.max(maxY, centroids[c + 1]);
          maxZ = Math.max(maxZ, centroids[c + 2]);
        }
        const ex = maxX - minX,
          ey = maxY - minY,
          ez = maxZ - minZ;
        const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
        const extent = axis === 0 ? ex : axis === 1 ? ey : ez;
        if (extent > 0 && extent < Infinity) {
          const low = axis === 0 ? minX : axis === 1 ? minY : minZ;
          const splitBin = this._bin(boxes, centroids, binOf, start, end, axis, low, extent);
          let left = start;
          let right = 0;
          for (let k = start; k < end; k++) {
            const t = tris[k];
            if (binOf[t] < splitBin) {
              codes[left] = codes[k];
              tris[left++] = t;
            } else {
              spareCodes[right] = codes[k];
              spareTris[right++] = t;
            }
          }
          codes.set(spareCodes.subarray(0, right), left);
          tris.set(spareTris.subarray(0, right), left);
          middle = left;
        }
      }

      if (middle < 0) {
        const first = codes[start];
        const last = codes[end - 1];
        if (first === last) {
          middle = (start + end) >>> 1;
        } else {
          const bit = 1 << (31 - Math.clz32(first ^ last));
          let low = start;
          let high = end - 1;
          while (low < high) {
            const m = (low + high) >>> 1;
            if (codes[m] & bit) high = m;
            else low = m + 1;
          }
          middle = low;
        }
      }

      const child = this._allocate();
      this._allocate();
      this._links[node * 8 + 6] = child;
      this._links[node * 8 + 7] = 0;
      if (top + 6 > work.length) {
        const grown = new Uint32Array(work.length * 2);
        grown.set(work);
        work = grown;
      }
      work[top++] = child;
      work[top++] = start;
      work[top++] = middle;
      work[top++] = child + 1;
      work[top++] = middle;
      work[top++] = end;
    }
  }

  /** Returns the first bin on the far side of the cheapest split; writes each triangle's bin into `binOf` */
  private _bin(
    boxes: Float32Array,
    centroids: Float32Array,
    binOf: Uint8Array,
    start: number,
    end: number,
    axis: number,
    low: number,
    extent: number,
  ): number {
    const tris = this._tris;
    const scale = (BINS * (1 - 1e-6)) / extent;
    binCounts.fill(0);
    for (let k = 0; k < BINS; k++) {
      binBounds.fill(Infinity, k * 6, k * 6 + 3);
      binBounds.fill(-Infinity, k * 6 + 3, k * 6 + 6);
    }
    for (let k = start; k < end; k++) {
      const t = tris[k];
      const bin = Math.min(BINS - 1, Math.max(0, ((centroids[t * 3 + axis] - low) * scale) | 0));
      binOf[t] = bin;
      binCounts[bin]++;
      const b = t * 6;
      const q = bin * 6;
      binBounds[q] = Math.min(binBounds[q], boxes[b]);
      binBounds[q + 1] = Math.min(binBounds[q + 1], boxes[b + 1]);
      binBounds[q + 2] = Math.min(binBounds[q + 2], boxes[b + 2]);
      binBounds[q + 3] = Math.max(binBounds[q + 3], boxes[b + 3]);
      binBounds[q + 4] = Math.max(binBounds[q + 4], boxes[b + 4]);
      binBounds[q + 5] = Math.max(binBounds[q + 5], boxes[b + 5]);
    }

    let x0 = Infinity,
      y0 = Infinity,
      z0 = Infinity;
    let x1 = -Infinity,
      y1 = -Infinity,
      z1 = -Infinity;
    for (let k = 0; k < BINS - 1; k++) {
      const q = k * 6;
      x0 = Math.min(x0, binBounds[q]);
      y0 = Math.min(y0, binBounds[q + 1]);
      z0 = Math.min(z0, binBounds[q + 2]);
      x1 = Math.max(x1, binBounds[q + 3]);
      y1 = Math.max(y1, binBounds[q + 4]);
      z1 = Math.max(z1, binBounds[q + 5]);
      leftAreas[k] = x0 === Infinity ? 0 : (x1 - x0) * (y1 - y0) + (y1 - y0) * (z1 - z0) + (z1 - z0) * (x1 - x0);
    }

    const count = end - start;
    let splitBin = 1;
    let bestCost = Infinity;
    let right = 0;
    x0 = y0 = z0 = Infinity;
    x1 = y1 = z1 = -Infinity;
    for (let k = BINS - 1; k > 0; k--) {
      const q = k * 6;
      right += binCounts[k];
      x0 = Math.min(x0, binBounds[q]);
      y0 = Math.min(y0, binBounds[q + 1]);
      z0 = Math.min(z0, binBounds[q + 2]);
      x1 = Math.max(x1, binBounds[q + 3]);
      y1 = Math.max(y1, binBounds[q + 4]);
      z1 = Math.max(z1, binBounds[q + 5]);
      if (right === 0 || right === count) continue;
      const rightArea = (x1 - x0) * (y1 - y0) + (y1 - y0) * (z1 - z0) + (z1 - z0) * (x1 - x0);
      const cost = leftAreas[k - 1] * (count - right) + rightArea * right;
      if (cost < bestCost) {
        bestCost = cost;
        splitBin = k;
      }
    }
    return splitBin;
  }

  /**
   * Fills bounds from the last node back, so children come before parents; a leaf reads `boxes`, or the vertices when
   * it's `null`. An empty tree returns early: its root leaf would be read as a parent
   */
  private _fitBounds(boxes: Float32Array | null): void {
    if (this._tris.length === 0) return;
    const positions = this._positions;
    const indices = this._indices;
    const tris = this._tris;
    const bounds = this._bounds;
    const links = this._links;

    for (let node = this._nodeCount - 1; node >= 0; node--) {
      let x0 = Infinity,
        y0 = Infinity,
        z0 = Infinity;
      let x1 = -Infinity,
        y1 = -Infinity,
        z1 = -Infinity;
      const first = links[node * 8 + 6];
      const size = links[node * 8 + 7];
      if (boxes && size > 0) {
        for (let k = first; k < first + size; k++) {
          const b = tris[k] * 6;
          x0 = Math.min(x0, boxes[b]);
          y0 = Math.min(y0, boxes[b + 1]);
          z0 = Math.min(z0, boxes[b + 2]);
          x1 = Math.max(x1, boxes[b + 3]);
          y1 = Math.max(y1, boxes[b + 4]);
          z1 = Math.max(z1, boxes[b + 5]);
        }
      } else if (size > 0) {
        for (let k = first; k < first + size; k++) {
          const tri = tris[k] * 3;
          const a = (indices ? indices[tri] : tri) * 3;
          const b = (indices ? indices[tri + 1] : tri + 1) * 3;
          const c = (indices ? indices[tri + 2] : tri + 2) * 3;
          x0 = Math.min(x0, positions[a], positions[b], positions[c]);
          y0 = Math.min(y0, positions[a + 1], positions[b + 1], positions[c + 1]);
          z0 = Math.min(z0, positions[a + 2], positions[b + 2], positions[c + 2]);
          x1 = Math.max(x1, positions[a], positions[b], positions[c]);
          y1 = Math.max(y1, positions[a + 1], positions[b + 1], positions[c + 1]);
          z1 = Math.max(z1, positions[a + 2], positions[b + 2], positions[c + 2]);
        }
      } else {
        const l = first * 8;
        const r = l + 8;
        x0 = Math.min(bounds[l], bounds[r]);
        y0 = Math.min(bounds[l + 1], bounds[r + 1]);
        z0 = Math.min(bounds[l + 2], bounds[r + 2]);
        x1 = Math.max(bounds[l + 3], bounds[r + 3]);
        y1 = Math.max(bounds[l + 4], bounds[r + 4]);
        z1 = Math.max(bounds[l + 5], bounds[r + 5]);
      }
      const o = node * 8;
      bounds[o] = x0;
      bounds[o + 1] = y0;
      bounds[o + 2] = z0;
      bounds[o + 3] = x1;
      bounds[o + 4] = y1;
      bounds[o + 5] = z1;
    }
  }

  private _allocate(): number {
    if ((this._nodeCount + 1) * 8 > this._bounds.length) {
      const grown = new Float32Array(this._bounds.length * 2);
      grown.set(this._bounds);
      this._bounds = grown;
      this._links = new Uint32Array(grown.buffer);
    }
    return this._nodeCount++;
  }
}
