import { warn } from 'pixi.js';

import { Geometry3D } from '../geometry/Geometry3D';
import { Box } from '../math/shapes/Box';
import { Sphere } from '../math/shapes/Sphere';
import type { Container3D } from '../scene/Container3D';
import { getLocalBounds3D } from '../scene/utils/getLocalBounds3D';
import type { HitVolume3D, HitVolume3DInput } from './HitResult3D';

// Duck-typing rather than `instanceof Mesh3D`: the import chain
//   Container3D → resolveHitVolume → Mesh3D → Container3D
// creates a TDZ cycle (Mesh3D extends Container3D before Container3D's class
// body finishes initialising). A property check has no such hazard.
interface MeshLike {
  geometry: Geometry3D;
}

function hasGeometry(node: Container3D): node is Container3D & MeshLike {
  return (node as Container3D & Partial<MeshLike>).geometry instanceof Geometry3D;
}

/**
 * Normalises a {@link HitVolume3DInput} to the shape stored on the node
 *
 * - `'box'` → `node.geometry.bounds3D` for a `Mesh3D`, which is live and tracks geometry mutations. For a plain
 *   `Container3D` it is the subtree AABB computed *now* — a snapshot, since plain containers have no live bounds
 *   maintenance. Hidden descendants count, unlike `getLocalBounds()`, so an invisible collider mesh gives the group
 *   a volume and children hidden at assignment are covered once they show. Re-set `hitVolume` (or pass an explicit
 *   `Box`) if the subtree changes shape later.
 * - `'geometry'` → `node.geometry`. Warns and resolves to `null` on a plain `Container3D`, which has no geometry.
 * - Raw `Box` / `Sphere` / `Geometry3D` instance → stored as-is, except that a `Sphere` with a negative radius is
 *   empty and resolves to `null` with a warning.
 * - Any other object implementing {@link IHitVolume3D} (structural: `raycast` + `boundingRadiusSq`) → stored as-is.
 * - `null` → `null`.
 *
 * Invalid input warns and resolves to `null` rather than throwing: a property setter shouldn't blow up an
 * assignment, and the node then falls back to its default shape, if any.
 * @param node - The node the volume is being set on; strings are resolved against it
 * @param input - The value assigned to `hitVolume`
 * @returns The stored shape, or `null` when there is no explicit shape
 * @internal
 */
export function resolveHitVolume(node: Container3D, input: HitVolume3DInput): HitVolume3D | null {
  if (input === null) return null;

  if (typeof input === 'string') {
    if (input === 'box') {
      if (hasGeometry(node)) return node.geometry.bounds3D;
      // A plain container has no geometry bounds, so the subtree AABB has to be computed here or the node never
      // hits.
      return getLocalBounds3D(node, new Box(), false);
    }
    if (input === 'geometry') {
      if (hasGeometry(node)) return node.geometry;
      warn("hitVolume: 'geometry' requires a Mesh3D — plain Container3D has no geometry; ignoring hitVolume");
      return null;
    }
    warn(`hitVolume: unsupported string '${String(input)}'. Expected 'box' or 'geometry'; ignoring hitVolume`);
    return null;
  }

  if (input instanceof Box) return input;
  if (input instanceof Sphere) {
    if (input.radius < 0) {
      warn('hitVolume: Sphere has a negative radius (empty) — ignoring hitVolume. Did you omit the radius argument?');
      return null;
    }
    return input;
  }
  if (input instanceof Geometry3D) return input;

  if (typeof input.raycast === 'function' && typeof input.boundingRadiusSq === 'number') return input;

  warn('hitVolume: expected Box, Sphere, Geometry3D, an IHitVolume3D, string shorthand, or null; ignoring hitVolume');
  return null;
}
