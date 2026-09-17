import type { Skeleton } from '../../scene/Skeleton';
import { Binding } from './Binding';

/**
 * Writes three-component position samples directly into a skeleton's local position buffer
 * @internal
 */
export class SkeletonPositionBinding extends Binding {
  constructor(
    private readonly _skel: Skeleton,
    private readonly _offset3: number,
  ) {
    super();
  }

  public apply(value: Float32Array): void {
    const p = this._offset3;
    const arr = this._skel.localPosition;
    arr[p] = value[0];
    arr[p + 1] = value[1];
    arr[p + 2] = value[2];
    this._skel.dirty = true;
  }
}
