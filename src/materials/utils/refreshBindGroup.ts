import type { BindGroup, BindResource } from 'pixi.js';

interface BindGroupKeys {
  resources: Record<number, BindResource | null>;
  _keyedIds: number[];
  _rekey(index: number, id: number): void;
}

/**
 * Does for a group set unwatched what pixi does on a resource's `change`; reads pixi's private key
 * state until pixi has a `BindGroup.refresh()`
 * @internal
 */
export function refreshBindGroup(group: BindGroup): void {
  const keyed = group as unknown as BindGroupKeys;
  const resources = keyed.resources;
  const keys = group._resourceKeys;

  for (let i = 0; i < keys.length; i++) {
    const index = keys[i];
    const resource = resources[index];
    if (!resource) continue;

    if (resource.destroyed) {
      resources[index] = null;
      keyed._rekey(index, -1);
      continue;
    }

    const id = resource._resourceId;
    if (keyed._keyedIds[index] !== id) keyed._rekey(index, id);
  }
}
