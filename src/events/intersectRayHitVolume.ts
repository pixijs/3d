import { Geometry3D } from '../geometry/Geometry3D';
import { Box } from '../math/shapes/Box';
import type { Ray } from '../math/shapes/Ray';
import { Sphere } from '../math/shapes/Sphere';
import type { HitResult3D, HitVolume3D } from './HitResult3D';
import { intersectRayGeometry } from './intersectRayGeometry';

/**
 * Conservative **squared** bounding radius of `volume`, measured from the node's local origin
 *
 * Origin-centred so the broadphase can take the node's world translation as the sphere centre for free, rejecting
 * missed nodes without inverting the world matrix. Squared space keeps the dominant Box / Geometry3D path
 * `sqrt`-free.
 *
 * Read per node per pick, so a volume mutated in place is reflected immediately.
 * @param volume - The node's resolved hit volume, in its local space
 * @returns The squared radius of an origin-centred sphere enclosing the volume
 * @internal
 */
export function hitVolumeBoundingRadiusSq(volume: HitVolume3D): number {
  if (volume instanceof Sphere) {
    const c = volume.center;
    const r = Math.sqrt(c.x * c.x + c.y * c.y + c.z * c.z) + Math.max(volume.radius, 0);
    return r * r;
  }

  if (volume instanceof Box || volume instanceof Geometry3D) {
    // Box or Geometry3D → squared distance from the origin to the farthest AABB
    // corner: per axis the farther face is the larger-magnitude bound. An empty
    // AABB (min=+Inf, max=-Inf) yields Infinity, so the broadphase never rejects.
    const box = volume instanceof Geometry3D ? volume.bounds3D : volume;
    const { min, max } = box;
    const x = Math.max(min.x * min.x, max.x * max.x);
    const y = Math.max(min.y * min.y, max.y * max.y);
    const z = Math.max(min.z * min.z, max.z * max.z);

    return x + y + z;
  }

  return volume.boundingRadiusSq;
}

/**
 * Ray vs. resolved hit volume, dispatched on the shape's runtime type
 *
 * The engine shapes get `instanceof` fast paths; anything else is a user-supplied {@link IHitVolume3D}
 * and is called through its `raycast`, which carries the same fill / miss contract as the branches
 * here.
 * @param localRay - The ray in the *node's local space*; the picker applies the node's inverse world transform
 * once before calling this
 * @param volume - The node's resolved hit volume
 * @param out - Scratch buffer filled in on a hit; untouched on a miss
 * @returns The parametric `t` of the closest hit (`>= 0`), or `-1` for a miss
 * @internal
 */
export function intersectRayHitVolume(localRay: Ray, volume: HitVolume3D, out: HitResult3D): number {
  if (volume instanceof Box) {
    // `intersectBoxT` returns the `t` where the ray meets the box — the entry face, or the exit face when the ray
    // starts inside. Taking `t` straight from the solve keeps the whole Box / Sphere narrowphase `sqrt`-free: the
    // point is `at(t)`, and `t` is already the distance because `localRay.direction` is unit length (`Ray.applyMatrix4`
    // renormalises it, so this holds under any node scale).
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
    return intersectRayGeometry(localRay, volume, out);
  }

  return volume.raycast(localRay, out);
}
