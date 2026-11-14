import type { Geometry3D } from '../geometry/Geometry3D';
import { rayTriangle, triangleHit } from '../geometry/utils/rayTriangle';
import type { Ray } from '../math/shapes/Ray';
import type { HitResult3D } from './HitResult3D';

/**
 * Below this, testing every triangle costs less than building and walking a hierarchy; `Geometry3D#bvh` names the
 * same count
 */
const BVH_MIN_TRIANGLES = 2048;

/**
 * Back faces hit too, so meshes with inverted winding still pick. A ray starting inside the bounds
 * always runs the triangle loop, since `intersectBoxT` then gives the exit distance, not the entry.
 * @returns The `t` of the closest hit, or `-1` for a miss.
 * @internal
 */
export function intersectRayGeometry(localRay: Ray, geom: Geometry3D, out: HitResult3D, maxT = Infinity): number {
  if (geom.topology !== 'triangle-list') return -1;

  const bounds = geom.bounds3D;
  const boundsT = localRay.intersectBoxT(bounds);
  if (boundsT === -1) return -1;
  if (boundsT >= maxT && !bounds.containsPoint(localRay.origin)) return -1;

  const positionAttr = geom.attributes.aPosition;
  if (!positionAttr) return -1;

  const positions = positionAttr.buffer.data;
  if (!(positions instanceof Float32Array)) return -1;

  const indexBuffer = geom.indexBuffer;
  const indices = indexBuffer ? (indexBuffer.data as Uint16Array | Uint32Array) : null;
  const triangleCount = indices ? indices.length / 3 : positions.length / 9;

  const ox = localRay.origin.x;
  const oy = localRay.origin.y;
  const oz = localRay.origin.z;
  const dx = localRay.direction.x;
  const dy = localRay.direction.y;
  const dz = localRay.direction.z;

  let bestT = maxT;
  let bestTri = -1;
  const bvh = !geom.dynamic && triangleCount >= BVH_MIN_TRIANGLES ? geom.bvh : null;
  if (bvh) {
    const t = bvh.raycast(localRay, maxT);
    if (t >= 0) {
      bestT = t;
      bestTri = bvh.triangle;
    }
  } else {
    for (let i = 0; i < triangleCount; i++) {
      const t = rayTriangle(positions, indices, i, ox, oy, oz, dx, dy, dz, bestT);
      if (t >= 0) {
        bestT = t;
        bestTri = i;
      }
    }
  }

  if (bestTri < 0) return -1;

  const { u: bestU, v: bestV, nx: bestNx, ny: bestNy, nz: bestNz } = triangleHit;
  const nLen = Math.sqrt(bestNx * bestNx + bestNy * bestNy + bestNz * bestNz);
  if (nLen > 0) {
    out.normal.set(bestNx / nLen, bestNy / nLen, bestNz / nLen);
  } else {
    out.normal.set(0, 0, 0);
  }

  out.point.set(ox + dx * bestT, oy + dy * bestT, oz + dz * bestT);
  out.distance = bestT;
  out.triangleIndex = bestTri;

  const uvAttr = geom.attributes.aUV;
  const uvData = uvAttr?.buffer.data;
  if (uvData instanceof Float32Array && indices) {
    const i0 = indices[bestTri * 3];
    const i1 = indices[bestTri * 3 + 1];
    const i2 = indices[bestTri * 3 + 2];
    const w = 1 - bestU - bestV;
    out.uv.x = uvData[i0 * 2] * w + uvData[i1 * 2] * bestU + uvData[i2 * 2] * bestV;
    out.uv.y = uvData[i0 * 2 + 1] * w + uvData[i1 * 2 + 1] * bestU + uvData[i2 * 2 + 1] * bestV;
  } else if (uvData instanceof Float32Array) {
    const i0 = bestTri * 3;
    const i1 = bestTri * 3 + 1;
    const i2 = bestTri * 3 + 2;
    const w = 1 - bestU - bestV;
    out.uv.x = uvData[i0 * 2] * w + uvData[i1 * 2] * bestU + uvData[i2 * 2] * bestV;
    out.uv.y = uvData[i0 * 2 + 1] * w + uvData[i1 * 2 + 1] * bestU + uvData[i2 * 2 + 1] * bestV;
  } else {
    out.uv.x = bestU;
    out.uv.y = bestV;
  }

  return bestT;
}
