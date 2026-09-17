import { Matrix4 } from '../../math/matrix/Matrix4';
import type { Container3D } from '../Container3D';

/** Scratch Matrix4 used as the ping-pong destination during ancestor walks */
const _scratch = new Matrix4();
/**
 * Reused per-call ancestor stack — module-scoped so the function allocates nothing
 *
 * Grows naturally as a V8 packed array; never shrinks. Stale slots past the
 * current depth are nulled on each call (see cleanup at the bottom of the
 * fill loop) so they don't pin previously-collected subtrees against GC.
 */
const _ancestors: (Container3D | null)[] = [];

/**
 * Computes the world transform of `target.parent` into `out` and returns it
 *
 * That is the matrix you'd multiply `target.localTransform` by to get
 * `target`'s current world transform. Walks up the parent chain refreshing
 * each ancestor's `localTransform` only if `_localTransformDirty` is set.
 *
 * Mirrors Pixi's `updateTransformBackwards` for 2D containers — used for
 * on-demand world transforms that don't go through the cascade (e.g. lookAt).
 * Does NOT mutate any container's stored `worldTransform`.
 *
 * NOT re-entrant: must not be called from inside itself (uses module-scoped
 * scratch state).
 * @param target - container whose parent-chain world transform is wanted
 * @param out - matrix the result is written into
 * @returns `out`, holding the parent's world transform (identity for roots).
 * @internal
 */
export function updateTransformBackwards3D(target: Container3D, out: Matrix4): Matrix4 {
  // Walk up collecting ancestors. Iterative so V8 can inline freely and
  // we avoid one stack frame per level.
  let depth = 0;
  let cur = target.parent;
  while (cur) {
    _ancestors[depth++] = cur;
    cur = cur.parent;
  }

  // Clear any stale tail entries from a previous deeper call so they don't
  // pin removed subtrees against GC. We stop at the first null/undefined
  // slot — that's either the previously-cleared boundary or the unallocated
  // tail. On equal/shallower repeats, this loop does no work.
  for (let i = depth; _ancestors[i]; i++) {
    _ancestors[i] = null;
  }

  if (depth === 0) return out.identity(); // No parent: parent world transform is identity.

  // Seed `out` with the root ancestor's local transform. Root has no parent,
  // so its local IS its world — naturally fast-paths the depth-1 case
  // (loop below skips, no matrix multiplies, just one copy).
  // Refreshes the local matrix only if dirty (consistent with the cascade).
  const root = _ancestors[depth - 1]!;
  if (root._localTransformDirty) {
    root.updateLocalTransform();
    root._localTransformDirty = false;
  }
  out.copyFrom(root.localTransform);

  // Walk down ping-ponging between `out` and `_scratch` so we avoid the
  // per-level `.copy()` that a `multiplyMatrices` + `copy` pair would need.
  // `multiplyAffine` skips bottom-row math (16 mul + 12 add saved per level).
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

  // If we ended up with the result in `_scratch`, copy it back into `out`.
  // Only fires when (depth - 1) iterations performed an odd number of swaps.
  if (src !== out) out.copyFrom(src);

  return out;
}
