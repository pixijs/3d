import type { Camera3D } from '../../scene/cameras/Camera3D';
import type { CullResults } from './CullResult';

/**
 * What a forward mesh draw should do, in terms that mean the same on both backends
 *
 * It says what to draw and in which order, never how. A pass builds one once and hands the same
 * object to `View3DPipe.prepareForward` and `View3DPipe.renderForward` every frame. Each pipe picks
 * its own way to do it: WebGPU a recorded render bundle or a replay without one, WebGL a cached
 * command list or a rebuild every frame.
 * @internal
 */
export interface RenderForwardDescriptor {
  /** The pass's bit, which picks the draw list on each batch and the mesh's cached shader */
  readonly bit: number;

  /**
   * The pass's own cull results per batch: its surviving instances, their counts and its bundles
   *
   * Every pass on the bit shares the draw list, but what its frustum keeps is its own. WebGL leaves
   * these empty and compacts each list in place.
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
   * Draw order
   *
   * - `'key'` sorts by the batch and pipeline key, which only changes with the meshes, so the draw
   *   can be cached.
   * - `'distance'` sorts back to front from the camera every frame, for alpha blending. Each pipe
   *   does its own distance math.
   */
  readonly sort: 'key' | 'distance';

  /**
   * Whether the pipe may reuse the draw work it built on frames where nothing changed
   *
   * `'auto'` reuses it until something changes; `'never'` rebuilds every frame. Left out, it
   * follows `sort`: `'key'` reuses and `'distance'` rebuilds. {@link cachesDrawWork} resolves it.
   */
  readonly cache?: 'auto' | 'never';

  /**
   * Whether the draw packs its meshes' textures for the shader; `false` skips it
   *
   * Left out, the textures are packed. Depth-only and solid-colour passes, such as outlines and
   * wireframes, set `false`.
   */
  readonly textures?: boolean;
}

/**
 * Whether a forward draw reuses its draw work on frames where nothing changed
 *
 * Resolves {@link RenderForwardDescriptor#cache}, following `sort` when it is unset. Both pipes
 * ask this: on `true` WebGPU records a render bundle and WebGL replays its built command list.
 * @param desc - The forward-draw descriptor to resolve
 * @returns `true` when draw work may be reused across clean frames
 * @internal
 */
export function cachesDrawWork(desc: RenderForwardDescriptor): boolean {
  return (desc.cache ?? (desc.sort === 'key' ? 'auto' : 'never')) === 'auto';
}
