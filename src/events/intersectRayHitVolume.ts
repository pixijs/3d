import { Geometry3D } from '../geometry/Geometry3D';
import { Box } from '../math/shapes/Box';
import type { Ray } from '../math/shapes/Ray';
import { Sphere } from '../math/shapes/Sphere';
import type { HitResult3D, HitVolume3D } from './HitResult3D';
import { intersectRayGeometry } from './intersectRayGeometry';

/**
 * Squared radius of a sphere about the node's local origin enclosing `volume`, as the pick in
 * `EventBoundary3D.ts` centres it on the node; uncached, so a shape edited in place picks right.
 * Tests `Geometry3D` first, the usual volume, since each failed `instanceof` walks its prototype chain
 * @internal
 */
export function hitVolumeBoundingRadiusSq(volume: HitVolume3D): number {
  if (volume instanceof Geometry3D || volume instanceof Box) {
    const { min, max } = volume instanceof Geometry3D ? volume.bounds3D : volume;
    const x = Math.max(min.x * min.x, max.x * max.x);
    const y = Math.max(min.y * min.y, max.y * max.y);
    const z = Math.max(min.z * min.z, max.z * max.z);

    return x + y + z;
  }

  if (volume instanceof Sphere) {
    const c = volume.center;
    const r = Math.sqrt(c.x * c.x + c.y * c.y + c.z * c.z) + Math.max(volume.radius, 0);
    return r * r;
  }

  return volume.boundingRadiusSq;
}

/**
 * @param localRay - The ray in the node's local space, with a unit-length direction, as
 * `IHitVolume3D.raycast` promises.
 * @param volume - The node's resolved hit volume.
 * @param out - Filled on a hit.
 * @param maxT - Nearest `t` found so far; only a `Geometry3D` uses it, to skip its triangle loop.
 * @returns The `t` of the closest hit, or `-1` for a miss.
 * @internal
 */
export function intersectRayHitVolume(localRay: Ray, volume: HitVolume3D, out: HitResult3D, maxT = Infinity): number {
  if (volume instanceof Box) {
    const t = localRay.intersectBoxT(volume);
    if (t === -1) return -1;
    localRay.at(t, out.point);
    out.distance = t;
    out.normal.set(0, 0, 0);
    out.uv.x = 0;
    out.uv.y = 0;
    out.triangleIndex = -1;
    return t;
  }

  if (volume instanceof Sphere) {
    const t = localRay.intersectSphereT(volume);
    if (t === -1) return -1;
    localRay.at(t, out.point);
    out.distance = t;
    out.normal.set(0, 0, 0);
    out.uv.x = 0;
    out.uv.y = 0;
    out.triangleIndex = -1;
    return t;
  }

  if (volume instanceof Geometry3D) {
    return intersectRayGeometry(localRay, volume, out, maxT);
  }

  return volume.raycast(localRay, out);
}
