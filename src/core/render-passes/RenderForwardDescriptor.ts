import type { Camera3D } from '../../scene/cameras/Camera3D';
import type { CullResults } from './CullResults';

/** @internal */
export interface RenderForwardDescriptor {
  readonly bit: number;

  readonly bindsMaterial: boolean;

  /** Per pass, since passes on one bit share each batch's draw list but can each have their own camera */
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
