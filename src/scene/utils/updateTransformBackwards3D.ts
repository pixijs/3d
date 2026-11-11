import { Matrix4 } from '../../math/matrix/Matrix4';
import type { Container3D } from '../Container3D';

const _scratch = new Matrix4();
/**
 * Pooled so the walk allocates nothing; each call nulls the slots past its depth so removed subtrees can be collected
 */
const _ancestors: (Container3D | null)[] = [];

/**
 * Computes the world transform of `target.parent` into `out`, without writing any stored `worldTransform`
 * @returns `out`
 * @internal
 */
export function updateTransformBackwards3D(target: Container3D, out: Matrix4): Matrix4 {
  let depth = 0;
  let cur = target.parent;
  while (cur) {
    _ancestors[depth++] = cur;
    cur = cur.parent;
  }

  for (let i = depth; _ancestors[i]; i++) {
    _ancestors[i] = null;
  }

  if (depth === 0) return out.identity();

  const root = _ancestors[depth - 1]!;
  if (root._localTransformDirty) {
    root.updateLocalTransform();
    root._localTransformDirty = false;
  }
  out.copyFrom(root.localTransform);

  let src = out;
  let dst = _scratch;
  for (let i = depth - 2; i >= 0; i--) {
    const ancestor = _ancestors[i]!;
    if (ancestor._localTransformDirty) {
      ancestor.updateLocalTransform();
      ancestor._localTransformDirty = false;
    }
    Matrix4.multiplyAffine(
      dst.elements as Float32Array,
      0,
      src.elements as Float32Array,
      0,
      ancestor.localTransform.elements as Float32Array,
      0,
    );
    const tmp = src;
    src = dst;
    dst = tmp;
  }

  if (src !== out) out.copyFrom(src);

  return out;
}
