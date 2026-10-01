import { Matrix4 } from '../../math/matrix/Matrix4';
import type { Container3D } from '../Container3D';

/** Scratch Matrix4 used as the ping-pong destination during ancestor walks */
const _scratch = new Matrix4();
/**
 * Reused per-call ancestor stack, module-scoped so the function allocates nothing
 *
 * Grows as a V8 packed array and never shrinks. Each call nulls the slots past its own
 * depth, up to the first empty one, so they don't keep removed subtrees from being
 * collected; a repeat at the same depth finds the next slot empty and does no work.
 */
const _ancestors: (Container3D | null)[] = [];

/**
 * Computes the world transform of `target.parent` into `out` and returns it
 *
 * That is the matrix you'd multiply `target.localTransform` by to get
 * `target`'s current world transform. Walks up the parent chain refreshing
 * each ancestor's `localTransform` only if `_localTransformDirty` is set.
 *
 * Mirrors pixi's `updateTransformBackwards` for 2D containers, for world
 * transforms needed outside the transform pass, such as `lookAt`. It doesn't
 * write any container's stored `worldTransform`.
 *
 * It starts from the topmost ancestor, whose local transform is its world
 * transform, and multiplies down. Each level writes into whichever of `out` and
 * `_scratch` didn't hold the last result, which saves a copy per level; the
 * result is copied into `out` only when it ends up in `_scratch`.
 *
 * Not re-entrant: it uses module-scoped scratch state.
 * @param target - container whose parent-chain world transform is wanted
 * @param out - matrix the result is written into
 * @returns `out`, holding the parent's world transform (identity for roots).
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
