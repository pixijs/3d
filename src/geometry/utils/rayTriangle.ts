const EPSILON = 1e-7;

/**
 * The barycentrics and unnormalised face normal of the last hit {@link rayTriangle} returned; a miss leaves them,
 * so after a search they belong to the closest hit
 * @internal
 */
export const triangleHit = { u: 0, v: 0, nx: 0, ny: 0, nz: 0 };

/**
 * Möller-Trumbore against triangle `i`; back faces hit too
 * @returns The hit's `t`, or `-1` for a miss or a hit at or beyond `maxT`.
 * @internal
 */
export function rayTriangle(
  positions: Float32Array,
  indices: Uint16Array | Uint32Array | null,
  i: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
): number {
  const i0 = (indices ? indices[i * 3] : i * 3) * 3;
  const i1 = (indices ? indices[i * 3 + 1] : i * 3 + 1) * 3;
  const i2 = (indices ? indices[i * 3 + 2] : i * 3 + 2) * 3;

  const ax = positions[i0];
  const ay = positions[i0 + 1];
  const az = positions[i0 + 2];

  const e1x = positions[i1] - ax;
  const e1y = positions[i1 + 1] - ay;
  const e1z = positions[i1 + 2] - az;
  const e2x = positions[i2] - ax;
  const e2y = positions[i2 + 1] - ay;
  const e2z = positions[i2 + 2] - az;

  const hx = dy * e2z - dz * e2y;
  const hy = dz * e2x - dx * e2z;
  const hz = dx * e2y - dy * e2x;

  const a = e1x * hx + e1y * hy + e1z * hz;
  if (a > -EPSILON && a < EPSILON) return -1;

  const f = 1 / a;
  const sx = ox - ax;
  const sy = oy - ay;
  const sz = oz - az;

  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return -1;

  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;

  const v = f * (dx * qx + dy * qy + dz * qz);
  if (v < 0 || u + v > 1) return -1;

  const t = f * (e2x * qx + e2y * qy + e2z * qz);
  if (t < EPSILON || t >= maxT) return -1;

  triangleHit.u = u;
  triangleHit.v = v;
  triangleHit.nx = e1y * e2z - e1z * e2y;
  triangleHit.ny = e1z * e2x - e1x * e2z;
  triangleHit.nz = e1x * e2y - e1y * e2x;

  return t;
}
