import type { Camera3D } from '../../scene/cameras/Camera3D';
import type { CullResults } from './CullResult';

/**
 * Declarative description of a forward mesh-draw
 *
 * Expresses *intent* — what to draw and how to order it — never backend mechanism. A pass
 * builds one of these once and hands the same object to `View3DPipe.renderForward` every
 * frame; each backend pipe chooses its own implementation (WebGPU: render bundle vs.
 * immediate replay; WebGL: persistent buffer + slot-map vs. full rebuild).
 *
 * Deliberately contains no backend terms — no `useBundles`, no `alwaysRebuild`.
 * @internal
 */
export interface RenderForwardDescriptor {
  /** The pass bit whose per-mesh cache + `drawLists` slot this draw drives (`pass.bit`) */
  readonly bit: number;

  /**
   * The pass's per-batch cull results — where its survivors, counts and bundles live
   *
   * The draw list is shared by every pass on the bit; what this pass's frustum decides is its
   * own. WebGL leaves it empty and compacts each list in place.
   */
  readonly cullResults: CullResults;

  /**
   * Camera to cull and draw from, or `null` for the view's own camera
   *
   * Supplies the frustum, the bind group at group 1, and the eye position the distance sort
   * measures from.
   */
  readonly camera: Camera3D | null;

  /**
   * Draw-ordering intent
   *
   * - `'key'` — sort by the static batch/pipeline key. Order is stable across frames
   *   unless meshes change, so it is cacheable.
   * - `'distance'` — back-to-front by camera distance, recomputed every frame (alpha
   *   blending). The backend owns the camera read and the distance math (which differ
   *   WebGPU vs. WebGL).
   */
  readonly sort: 'key' | 'distance';

  /**
   * Caching policy — the backend picks (and may adapt) the mechanism
   *
   * Optional; defaults from `sort` (`'key'` → `'auto'`, `'distance'` → `'never'`).
   * - `'auto'` — the backend may reuse recorded draw work across clean frames and rebuild
   *   only on dirty. May grow adaptive heuristics (e.g. defer bundle compile until the
   *   pass set is stable).
   * - `'never'` — rebuild draw work every frame.
   */
  readonly cache?: 'auto' | 'never';

  /**
   * Texture batching
   *
   * `true` (default) packs a texture atlas + batch texture bind group; `false` is for
   * depth-only / solid-colour passes such as outline and wireframe.
   */
  readonly textures?: boolean;
}

/**
 * Whether this pass caches its draw work across clean frames
 *
 * Resolves the `cache` policy, defaulting from `sort` when `cache` is unset (`'key'` caches,
 * `'distance'` rebuilds every frame). Single source of truth for both pipes: WebGPU maps
 * `true` to recording a render bundle, WebGL to keeping its persistent slot-map.
 * @param desc - The forward-draw descriptor to resolve
 * @returns `true` when draw work may be reused across clean frames
 * @internal
 */
export function cachesDrawWork(desc: RenderForwardDescriptor): boolean {
  return (desc.cache ?? (desc.sort === 'key' ? 'auto' : 'never')) === 'auto';
}
