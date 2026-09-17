import type { Skeleton } from '../../scene/Skeleton';
import { Binding } from './Binding';

/**
 * Writes four-component quaternion samples directly into a skeleton's local rotation buffer
 * @internal
 */
export class SkeletonRotationBinding extends Binding {
  constructor(
    private readonly _skel: Skeleton,
    private readonly _offset4: number,
  ) {
    super();
  }

  public apply(value: Float32Array): void {
    const r = this._offset4;
    const arr = this._skel.localRotation;
    const x = value[0];
    const y = value[1];
    const z = value[2];
    const w = value[3];
    // Blended samples are a weighted average of unit quaternions (nlerp) —
    // renormalize so bone matrices don't pick up a scale from short rotations.
    const lengthSq = x * x + y * y + z * z + w * w;
    const inv = lengthSq > 0 ? 1 / Math.sqrt(lengthSq) : 0;

    arr[r] = x * inv;
    arr[r + 1] = y * inv;
    arr[r + 2] = z * inv;
    arr[r + 3] = inv === 0 ? 1 : w * inv;
    this._skel.dirty = true;
  }
}
