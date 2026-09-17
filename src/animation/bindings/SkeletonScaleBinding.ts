import type { Skeleton } from '../../scene/Skeleton';
import { Binding } from './Binding';

/**
 * Writes three-component scale samples directly into a skeleton's local scale buffer
 * @internal
 */
export class SkeletonScaleBinding extends Binding {
  constructor(
    private readonly _skel: Skeleton,
    private readonly _offset3: number,
  ) {
    super();
  }

  public apply(value: Float32Array): void {
    const s = this._offset3;
    const arr = this._skel.localScale;
    arr[s] = value[0];
    arr[s + 1] = value[1];
    arr[s + 2] = value[2];
    this._skel.dirty = true;
  }
}
