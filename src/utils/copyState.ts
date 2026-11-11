import type { State } from 'pixi.js';

/**
 * Gives `target` every setting of `source`; `data` goes last, because the `blendMode` and
 * `polygonOffset` setters also write flags into it
 * @internal
 */
export function copyState(target: State, source: State): void {
  target.blendMode = source.blendMode;
  target.polygonOffset = source.polygonOffset;
  target.data = source.data;
}
