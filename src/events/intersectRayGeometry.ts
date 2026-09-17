import type { Geometry3D } from '../geometry/Geometry3D';
import type { Ray } from '../math/shapes/Ray';
import type { HitResult3D } from './HitResult3D';

const EPSILON = 1e-7;

/**
 * Ray vs. `Geometry3D`, Möller-Trumbore per triangle
 *
 * Two stages: an AABB pre-reject against `geom.bounds3D`, so a miss against a 10k-tri mesh still returns in O(1)
 * on mobile, then the triangle loop tracking the closest `t`.
 *
 * Requires float32 `aPosition` data. Quantised meshes (KHR_mesh_quantization — int8/int16 positions) would need
 * shader-side unquantisation, which this has no metadata for, and are treated as a miss; use `hitVolume = 'box'`
 * for those, or supply a non-quantised proxy geometry.
 *
 * Requires `'triangle-list'` topology. Line, strip and point geometry is a miss too: its index buffer would
 * otherwise be decoded as garbage triangles. Use `'box'` or a triangle-list proxy geometry for those.
 * @param localRay - The ray in the geometry's local space
 * @param geom - The geometry to test every triangle of
 * @param out - Scratch buffer filled with the closest hit's point / normal / UV; untouched on a miss
 * @returns The parametric `t` of the closest hit (`>= 0`), or `-1` for a miss, for non-triangle-list topology, and
 * for geometry with no float32 `aPosition` data
 * @internal
 */
export function intersectRayGeometry(localRay: Ray, geom: Geometry3D, out: HitResult3D): number {
  if (geom.topology !== 'triangle-list') return -1;

  // Bounds are read fresh each call, so in-place geometry edits are picked up immediately.
  if (!localRay.intersectsBox(geom.bounds3D)) return -1;

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

  let bestT = Infinity;
  let bestTri = -1;
  let bestU = 0;
  let bestV = 0;
  let bestNx = 0;
  let bestNy = 0;
  let bestNz = 0;

  for (let i = 0; i < triangleCount; i++) {
    const i0 = indices ? indices[i * 3] : i * 3;
    const i1 = indices ? indices[i * 3 + 1] : i * 3 + 1;
    const i2 = indices ? indices[i * 3 + 2] : i * 3 + 2;

    const ax = positions[i0 * 3];
    const ay = positions[i0 * 3 + 1];
    const az = positions[i0 * 3 + 2];

    const bx = positions[i1 * 3];
    const by = positions[i1 * 3 + 1];
    const bz = positions[i1 * 3 + 2];

    const cx = positions[i2 * 3];
    const cy = positions[i2 * 3 + 1];
    const cz = positions[i2 * 3 + 2];

    const e1x = bx - ax;
    const e1y = by - ay;
    const e1z = bz - az;
    const e2x = cx - ax;
    const e2y = cy - ay;
    const e2z = cz - az;

    // h = dir × e2
    const hx = dy * e2z - dz * e2y;
    const hy = dz * e2x - dx * e2z;
    const hz = dx * e2y - dy * e2x;

    const a = e1x * hx + e1y * hy + e1z * hz;
    // Only rejects rays parallel to the triangle. The sign of `a` is not tested, so back faces hit too and picking
    // works on inverted-normal authoring.
    if (a > -EPSILON && a < EPSILON) continue;

    const f = 1 / a;
    const sx = ox - ax;
    const sy = oy - ay;
    const sz = oz - az;

    const u = f * (sx * hx + sy * hy + sz * hz);
    if (u < 0 || u > 1) continue;

    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;

    const v = f * (dx * qx + dy * qy + dz * qz);
    if (v < 0 || u + v > 1) continue;

    const t = f * (e2x * qx + e2y * qy + e2z * qz);
    if (t < EPSILON) continue;
    if (t >= bestT) continue;

    bestT = t;
    bestTri = i;
    bestU = u;
    bestV = v;
    // Flat normal from the triangle's edges, so hits still carry a normal on geometry with no `aNormal` attribute.
    bestNx = e1y * e2z - e1z * e2y;
    bestNy = e1z * e2x - e1x * e2z;
    bestNz = e1x * e2y - e1y * e2x;
  }

  if (bestTri < 0) return -1;

  const nLen = Math.sqrt(bestNx * bestNx + bestNy * bestNy + bestNz * bestNz);
  if (nLen > 0) {
    out.normal.set(bestNx / nLen, bestNy / nLen, bestNz / nLen);
  } else {
    out.normal.set(0, 0, 0);
  }

  out.point.set(ox + dx * bestT, oy + dy * bestT, oz + dz * bestT);
  out.distance = bestT;
  out.triangleIndex = bestTri;

  // Barycentric interpolation over `aUV` when present. `aUV` may be int16 (KHR quantised), so only float32 data is
  // read; anything else falls through to the raw barycentrics rather than emitting corrupt coordinates.
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
