import type { Ray } from '../math/shapes/Ray';
import { triangleHit } from './utils/rayTriangle';

/** Most triangles a leaf holds */
const LEAF_SIZE = 4;
/**
 * Nodes with more triangles than this split where the surface area heuristic says rays cost least; smaller ones
 * split along the Morton order, which needs no pass over their triangles
 */
const SAH_MIN_TRIANGLES = 128;
const BINS = 16;
const EPSILON = 1e-7;

const buckets = new Uint32Array(1024);
const binCounts = new Uint32Array(BINS);
/** Six per bin: the min xyz then max xyz of its triangles' boxes */
const binBounds = new Float64Array(BINS * 6);
const leftAreas = new Float64Array(BINS);
let stack = new Int32Array(64);
/** The entry distance of each node on `stack`, so a pop compares it with the closest hit instead of testing again */
let stackEntries = new Float64Array(64);

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
 * Read one from {@link Geometry3D#bvh | geometry.bvh} rather than constructing it, so it is built once and
 * rebuilt when the geometry changes. It holds the arrays it was built from and never notices edits to them.
 * @example
 * ```ts
 * const bvh = geometry.bvh;
 * const distance = bvh ? bvh.raycast(localRay) : -1;
 * if (distance >= 0) console.log('hit triangle', bvh!.triangle, 'at', distance);
 * ```
 * @category geometry
 * @advanced
 */
export class TriangleBvh {
  /** The vertex positions the hierarchy was built over, three numbers per vertex */
  public readonly positions: Float32Array;
  /** The vertex numbers, three per triangle; `null` when every three vertices in order make a triangle */
  public readonly indices: Uint16Array | Uint32Array | null;
  /** The triangle the last hit from {@link TriangleBvh#raycast} landed on; `-1` after a miss */
  public triangle = -1;

  /**
   * A 32-byte record per node: min xyz and max xyz, then `first` and `count` read through `_links`. A leaf holds
   * `count` triangles from `_tris[first]`; an inner node has `count` 0 and its children at `first` and `first + 1`,
   * after itself, so a pass from the last node back meets children before parents.
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
    this.positions = positions;
    this.indices = indices;
    const count = indices ? indices.length / 3 : positions.length / 9;
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
    this._fitBounds(boxes, count);
  }

  /**
   * Finds the closest triangle the ray hits before `maxT`, front or back face, and stores it in
   * {@link TriangleBvh#triangle}
   * @param ray - The ray, in the same space as the positions, such as a geometry's own axes
   * @param maxT - Ignore hits this far along the ray or farther
   * @returns The distance along the ray to the hit, or `-1` for a miss.
   */
  public raycast(ray: Ray, maxT = Infinity): number {
    const ox = ray.origin.x,
      oy = ray.origin.y,
      oz = ray.origin.z;
    const dx = ray.direction.x,
      dy = ray.direction.y,
      dz = ray.direction.z;
    const ix = 1 / dx,
      iy = 1 / dy,
      iz = 1 / dz;
    const positions = this.positions;
    const indices = this.indices;
    const tris = this._tris;
    const bounds = this._bounds;
    const links = this._links;
    let best = maxT;
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
          if (u < 0 || u > 1) continue;
          const qx = sy * e1z - sz * e1y,
            qy = sz * e1x - sx * e1z,
            qz = sx * e1y - sy * e1x;
          const v = f * (dx * qx + dy * qy + dz * qz);
          if (v < 0 || u + v > 1) continue;
          const t = f * (e2x * qx + e2y * qy + e2z * qz);
          if (t < EPSILON || t >= best) continue;
          best = t;
          bestSlot = slot;
          bestU = u;
          bestV = v;
        }
        continue;
      }

      if (top + 2 > stack.length) {
        const grown = new Int32Array(stack.length * 2);
        grown.set(stack);
        stack = grown;
        const grownEntries = new Float64Array(stackEntries.length * 2);
        grownEntries.set(stackEntries);
        stackEntries = grownEntries;
      }
      let o = first * 8;
      let x0 = (bounds[o] - ox) * ix,
        x1 = (bounds[o + 3] - ox) * ix;
      let y0 = (bounds[o + 1] - oy) * iy,
        y1 = (bounds[o + 4] - oy) * iy;
      let z0 = (bounds[o + 2] - oz) * iz,
        z1 = (bounds[o + 5] - oz) * iz;
      let enter = Math.max(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), 0);
      let exit = Math.min(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1));
      const near = exit >= enter ? enter : exit < enter ? Infinity : 0;
      o += 8;
      x0 = (bounds[o] - ox) * ix;
      x1 = (bounds[o + 3] - ox) * ix;
      y0 = (bounds[o + 1] - oy) * iy;
      y1 = (bounds[o + 4] - oy) * iy;
      z0 = (bounds[o + 2] - oz) * iz;
      z1 = (bounds[o + 5] - oz) * iz;
      enter = Math.max(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), 0);
      exit = Math.min(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1));
      const far = exit >= enter ? enter : exit < enter ? Infinity : 0;

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

    const tri = tris[bestSlot] * 3;
    const a = (indices ? indices[tri] : tri) * 3;
    const b = (indices ? indices[tri + 1] : tri + 1) * 3;
    const c = (indices ? indices[tri + 2] : tri + 2) * 3;
    const e1x = positions[b] - positions[a],
      e1y = positions[b + 1] - positions[a + 1],
      e1z = positions[b + 2] - positions[a + 2];
    const e2x = positions[c] - positions[a],
      e2y = positions[c + 1] - positions[a + 1],
      e2z = positions[c + 2] - positions[a + 2];
    triangleHit.u = bestU;
    triangleHit.v = bestV;
    triangleHit.nx = e1y * e2z - e1z * e2y;
    triangleHit.ny = e1z * e2x - e1x * e2z;
    triangleHit.nz = e1x * e2y - e1y * e2x;
    this.triangle = tris[bestSlot];
    return best;
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
        if (extent > 0) {
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

  /**
   * Sorts `tris[start..end)` into bins by centroid along `axis` and picks the split between bins where rays cost least,
   * assuming a ray meets a box in proportion to its surface area
   * @returns The first bin of the far side; `binOf` holds each triangle's bin.
   */
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

  /** Fills each node's bounds from the last node back, so children are done before their parent */
  private _fitBounds(boxes: Float32Array, count: number): void {
    if (this._nodeCount * 8 < this._bounds.length) {
      this._bounds = this._bounds.slice(0, this._nodeCount * 8);
      this._links = new Uint32Array(this._bounds.buffer);
    }
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
      if (size > 0 || count === 0) {
        for (let k = first; k < first + size; k++) {
          const b = tris[k] * 6;
          x0 = Math.min(x0, boxes[b]);
          y0 = Math.min(y0, boxes[b + 1]);
          z0 = Math.min(z0, boxes[b + 2]);
          x1 = Math.max(x1, boxes[b + 3]);
          y1 = Math.max(y1, boxes[b + 4]);
          z1 = Math.max(z1, boxes[b + 5]);
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
