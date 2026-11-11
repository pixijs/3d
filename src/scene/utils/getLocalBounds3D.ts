import { Matrix4 } from '../../math/matrix/Matrix4';
import { Box } from '../../math/shapes/Box';
import type { Container3D } from '../Container3D';
import type { Mesh3D } from '../Mesh3D';

const tempBox = new Box();

/** One scratch matrix per tree depth, grown on demand, so a walk allocates nothing once warm */
const matrixStack: Matrix4[] = [];

/**
 * Measures as {@link Container3D#getLocalBounds} documents
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

function unionTransformed(box: Box, out: Box, matrix: Matrix4 | null): void {
  out.union(matrix ? box.applyMatrix4(matrix, tempBox) : box);
}
