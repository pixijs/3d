import type { Camera3D } from '../../scene/cameras/Camera3D';
import type { CullResults } from './CullResults';

/** @internal */
export interface RenderForwardDescriptor {
  readonly bit: number;

  /**
   * The pass's own cull results per batch: its surviving instances, their counts and its bundles
   *
   * Every pass on the bit shares the draw list, but what its frustum keeps is its own. WebGL leaves
   * these empty and compacts each list in place.
   */
  readonly cullResults: CullResults;

  /** `null` for the view's own camera */
  readonly camera: Camera3D | null;

  readonly sort: 'key' | 'distance';

  /** Unset follows `sort`: a `'key'` pass caches and a `'distance'` pass doesn't */
  readonly cache?: 'auto' | 'never';
}

/** @internal */
export function cachesDrawWork(desc: RenderForwardDescriptor): boolean {
  return (desc.cache ?? (desc.sort === 'key' ? 'auto' : 'never')) === 'auto';
}
