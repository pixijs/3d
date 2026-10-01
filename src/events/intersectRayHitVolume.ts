import { Geometry3D } from '../geometry/Geometry3D';
import { Box } from '../math/shapes/Box';
import type { Ray } from '../math/shapes/Ray';
import { Sphere } from '../math/shapes/Sphere';
import type { HitResult3D, HitVolume3D } from './HitResult3D';
import { intersectRayGeometry } from './intersectRayGeometry';

/**
 * Squared radius of a sphere around the node's local origin that encloses `volume`
 *
 * Centred on the origin so the broadphase can use the node's world translation as the centre,
 * rejecting a missed node without inverting its world matrix. Squared, so the common Box and
 * Geometry3D path needs no `sqrt`.
 *
 * For a box, it is the squared distance to the farthest corner: on each axis, the larger squared
 * bound. An empty box (`min` at `+Infinity`, `max` at `-Infinity`) gives `Infinity`, so the
 * broadphase never rejects it.
 *
 * Read per node per pick, so a volume edited in place takes effect on the next pick.
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
 * Tests a ray against a resolved hit volume, picking the test by the shape's type
 *
 * The engine shapes get `instanceof` branches; anything else is an {@link IHitVolume3D} and is
 * called through its `raycast`.
 *
 * A `Box` or `Sphere` hit is where the ray enters the shape, or leaves it when the ray starts
 * inside. Its `t` is already the distance to the hit, because `localRay.direction` is unit length:
 * `Ray.applyMatrix4` renormalises it under any node scale.
 * @param localRay - The ray in the *node's local space*; the picker applies the node's inverse world transform
 * once before calling this
 * @param volume - The node's resolved hit volume
 * @param out - Scratch buffer filled on a hit; the caller ignores it on a miss
 * @returns The parametric `t` of the closest hit (`>= 0`), or `-1` for a miss
 * @internal
 */
export function intersectRayHitVolume(localRay: Ray, volume: HitVolume3D, out: HitResult3D): number {
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
    return intersectRayGeometry(localRay, volume, out);
  }

  return volume.raycast(localRay, out);
}
