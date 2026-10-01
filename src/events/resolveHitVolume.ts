import { warn } from 'pixi.js';

import { Geometry3D } from '../geometry/Geometry3D';
import { Box } from '../math/shapes/Box';
import { Sphere } from '../math/shapes/Sphere';
import type { Container3D } from '../scene/Container3D';
import { getLocalBounds3D } from '../scene/utils/getLocalBounds3D';
import type { HitVolume3D, HitVolume3DInput } from './HitResult3D';

interface MeshLike {
  geometry: Geometry3D;
}

/**
 * Whether `node` is a mesh, tested by its `geometry` rather than with `instanceof Mesh3D`
 *
 * `Mesh3D` imports this module, so importing it back would make an import cycle.
 * @param node - Node to test.
 * @returns Whether the node has a `Geometry3D`.
 */
function hasGeometry(node: Container3D): node is Container3D & MeshLike {
  return (node as Container3D & Partial<MeshLike>).geometry instanceof Geometry3D;
}

/**
 * Turns a {@link HitVolume3DInput} into the shape the node is picked against
 *
 * - `'box'`: a mesh's `geometry.bounds3D`, which follows edits to the geometry. A plain
 *   `Container3D` has no bounds of its own, so it gets its subtree's bounds measured now, hidden
 *   descendants included. Set `hitVolume` again if the subtree changes shape.
 * - `'geometry'`: the mesh's geometry. A plain `Container3D` has none, so it warns.
 * - A `Box`, `Sphere`, `Geometry3D` or other {@link IHitVolume3D}: stored as given. A `Sphere`
 *   with a negative radius is empty, so it warns.
 *
 * Invalid input warns and resolves to `null` rather than throwing from a property setter; the
 * node then uses its default shape, if it has one.
 * @param node - The node the volume is being set on; strings are resolved against it
 * @param input - The value assigned to `hitVolume`
 * @returns The shape to pick against, or `null` for none
 * @internal
 */
export function resolveHitVolume(node: Container3D, input: HitVolume3DInput): HitVolume3D | null {
  if (input === null) return null;

  if (typeof input === 'string') {
    if (input === 'box') {
      if (hasGeometry(node)) return node.geometry.bounds3D;
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
