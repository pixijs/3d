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

/** Not `instanceof Mesh3D`, since `Mesh3D` imports this module and importing it back makes a cycle */
function hasGeometry(node: Container3D): node is Container3D & MeshLike {
  return (node as Container3D & Partial<MeshLike>).geometry instanceof Geometry3D;
}

/**
 * A string resolves against the node's current geometry, so `Mesh3D`'s `geometry` setter resolves it again
 * @returns The shape to pick against, or `null` for none or invalid input.
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
