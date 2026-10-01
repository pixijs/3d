import type { Geometry3D } from '../geometry/Geometry3D';
import type { Ray } from '../math/shapes/Ray';
import type { HitResult3D } from './HitResult3D';

const EPSILON = 1e-7;

/**
 * Tests a ray against every triangle of a `Geometry3D` with the Möller-Trumbore method
 *
 * A ray that misses `geom.bounds3D` returns before the triangle loop, so a miss costs the same
 * on any mesh size. Bounds and vertex data are read on every call, so edits to the geometry
 * take effect on the next pick. The loop keeps the closest `t`; its names follow the method:
 * `e1` and `e2` are the triangle's edges, `h = direction × e2`, `s = origin - a` and
 * `q = s × e1`.
 *
 * - Back faces hit too: only a ray parallel to the triangle is rejected, not the sign of `a`, so
 *   meshes authored with inverted normals still pick.
 * - The normal is the triangle's flat normal from its edges, so it exists even without an
 *   `aNormal` attribute.
 * - The UV is interpolated from `aUV` when it is float32. Other `aUV` data, such as quantised
 *   int16, is skipped rather than decoded wrong, and `out.uv` gets the hit's barycentric
 *   coordinates instead.
 *
 * Only float32 `aPosition` data and `'triangle-list'` topology can hit. Quantised positions
 * (KHR_mesh_quantization) are only dequantised in the shader, and a line, strip or point index
 * buffer would decode as nonsense triangles; both count as a miss. Use `'box'` or a proxy
 * geometry for those.
 * @param localRay - The ray in the geometry's local space
 * @param geom - The geometry to test every triangle of
 * @param out - Scratch buffer filled with the closest hit's point / normal / UV; untouched on a miss
 * @returns The parametric `t` of the closest hit (`>= 0`), or `-1` for a miss, for non-triangle-list topology, and
 * for geometry with no float32 `aPosition` data
 * @internal
 */
export function intersectRayGeometry(localRay: Ray, geom: Geometry3D, out: HitResult3D): number {
  if (geom.topology !== 'triangle-list') return -1;

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

    const hx = dy * e2z - dz * e2y;
    const hy = dz * e2x - dx * e2z;
    const hz = dx * e2y - dy * e2x;

    const a = e1x * hx + e1y * hy + e1z * hz;
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
