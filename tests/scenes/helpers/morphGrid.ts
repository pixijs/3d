import { Geometry3D } from '~/geometry/Geometry3D';

/**
 * Builds a camera-facing grid plane (XY plane, normals +Z) with two morph
 * targets that stretch it in-plane:
 *   - target 0: widens the plane along X
 *   - target 1: heightens the plane along Y
 *
 * In-plane stretch keeps the lit surface visible head-on while making the
 * morphed silhouette obvious, so a broken morph path is easy to spot. Deltas
 * are POSITION-only (v1 scope). Not a `.scene.ts` so the runner doesn't execute
 * it directly.
 */
export function createMorphGrid(segments = 16): Geometry3D {
  const size = 1.2;
  const half = size / 2;
  const verts = segments + 1;
  const count = verts * verts;

  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const wide = new Float32Array(count * 3);
  const tall = new Float32Array(count * 3);

  let p = 0;
  for (let y = 0; y < verts; y++) {
    for (let x = 0; x < verts; x++) {
      const fx = (x / segments) * size - half;
      const fy = (y / segments) * size - half;

      positions[p] = fx;
      positions[p + 1] = fy;
      positions[p + 2] = 0;

      normals[p] = 0;
      normals[p + 1] = 0;
      normals[p + 2] = 1;

      wide[p] = fx * 0.8;
      wide[p + 1] = 0;
      wide[p + 2] = 0;

      tall[p] = 0;
      tall[p + 1] = fy * 0.8;
      tall[p + 2] = 0;

      p += 3;
    }
  }

  const indices: number[] = [];
  for (let y = 0; y < segments; y++) {
    for (let x = 0; x < segments; x++) {
      const a = y * verts + x;
      const b = a + 1;
      const c = a + verts;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  return new Geometry3D({
    positions,
    normals,
    indices: new Uint32Array(indices),
    morphTargets: [{ positions: wide }, { positions: tall }],
    quantizeNormals: false,
  });
}
