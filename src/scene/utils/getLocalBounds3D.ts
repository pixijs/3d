import { Matrix4 } from '../../math/matrix/Matrix4';
import { Box } from '../../math/shapes/Box';
import type { Container3D } from '../Container3D';
import type { Mesh3D } from '../Mesh3D';

const tempBox = new Box();

/** One scratch matrix per tree depth, grown on demand, so a walk allocates nothing once warm */
const matrixStack: Matrix4[] = [];

/**
 * Measures the axis-aligned bounding {@link Box} of `container` and its descendants into `out`
 *
 * Each node contributes its {@link Container3D.boundsVolume | boundsVolume} when one is set, which
 * also stands in for its whole subtree; otherwise its geometry bounds (if it is a {@link Mesh3D})
 * and then its children's. Each contribution is transformed by its node's matrix relative to
 * `container`, so the result is in `container`'s local space. An empty subtree measures as a zero
 * box at the origin.
 *
 * With `skipHidden`, a hidden descendant contributes nothing, and neither does its subtree, so an
 * invisible collider or LOD mesh never inflates the measurement. `container` itself is always
 * measured, even when hidden.
 * @param container - Subtree root to measure
 * @param out - Box the result is written into; reset first
 * @param skipHidden - Leave out hidden descendants and their subtrees
 * @returns `out`
 * @internal
 */
export function getLocalBounds3D(container: Container3D, out: Box, skipHidden = true): Box {
  out.makeEmpty();

  addBounds(container, out, null, 0, skipHidden);

  if (out.isEmpty()) {
    out.min.set(0, 0, 0);
    out.max.set(0, 0, 0);
  }

  return out;
}

/**
 * Unions `container`'s contribution and its subtree's into `out`
 * @param container - Node being measured
 * @param out - Box the bounds are unioned into
 * @param matrix - Transform from `container`'s local space into the measured space; `null` for identity
 * @param depth - Depth below the measured root, indexing {@link matrixStack}
 * @param skipHidden - Leave out hidden children and their subtrees
 */
function addBounds(container: Container3D, out: Box, matrix: Matrix4 | null, depth: number, skipHidden: boolean): void {
  const boundsVolume = container.boundsVolume;

  if (boundsVolume) {
    unionTransformed(boundsVolume, out, matrix);

    return;
  }

  const geometry = (container as Mesh3D).geometry;

  if (geometry) unionTransformed(geometry.bounds3D, out, matrix);

  const children = container.children;

  if (children.length === 0) return;

  const childMatrix = (matrixStack[depth] ??= new Matrix4());

  for (let i = 0; i < children.length; i++) {
    const child = children[i];

    if (skipHidden && !child.visible) continue;

    child.updateLocalTransform();

    if (matrix) childMatrix.copyFrom(matrix).multiply(child.localTransform);
    else childMatrix.copyFrom(child.localTransform);

    addBounds(child, out, childMatrix, depth + 1, skipHidden);
  }
}

/**
 * Unions `box`, transformed by `matrix`, into `out`
 * @param box - Box in the node's local space
 * @param out - Box the result is unioned into
 * @param matrix - Transform into the measured space; `null` for identity
 */
function unionTransformed(box: Box, out: Box, matrix: Matrix4 | null): void {
  out.union(matrix ? box.applyMatrix4(matrix, tempBox) : box);
}
