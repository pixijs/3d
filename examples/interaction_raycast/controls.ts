/**
 * The pane: what the last hit carries, as read-only rows, the options the lesson changes, and a count of the hits
 * raycast creates while Reuse hover is off
 *
 * The rows read getters that format the last hit, so the pane formats ten times a second and the ticker formats
 * nothing for it, plus once the frame the pick swaps between a hit and a miss or onto another shape, so the target row
 * changes with the glow. On a miss the rows grey out and keep the last hit's values, the way `hover` keeps them.
 */

import type { Container3D, RaycastHit3D, Vector2, Vector3 } from '@pixi/3d';

import type { ThemePane } from '../shared/theme/ThemePane';

/** What each shape is picked against: every triangle, or the geometry's bounding box */
export type HitVolumeChoice = 'geometry' | 'box';

export interface Settings {
  /** Hands raycast the one hit to fill, rather than taking a new object for each */
  reuseHover: boolean;
  /** The field's turn, in radians a second */
  turntable: number;
  hitVolume: HitVolumeChoice;
}

export interface ControlsOptions {
  pane: ThemePane;
  settings: Settings;
  /** The hit `index.ts` hands raycast, for telling it apart from a new object */
  hover: RaycastHit3D;
  /** Sets every shape's hitVolume */
  setHitVolume: (volume: HitVolumeChoice) => void;
}

export interface Controls {
  /** Takes what this frame's raycast returned */
  update(hit: RaycastHit3D | null): void;
}

/** Ten times a second: often enough to follow a pick, rarely enough that the formatting costs nothing */
const MONITOR = { readonly: true, interval: 100 } as const;

/** A number to 2 decimals, rounded first so -0.001 shows as 0.00, not -0.00 */
function fixed2(value: number): string {
  return (Math.round(value * 100) / 100 || 0).toFixed(2);
}

function vector3(v: Vector3): string {
  return `(${fixed2(v.x)}, ${fixed2(v.y)}, ${fixed2(v.z)})`;
}

function vector2(v: Vector2): string {
  return `(${fixed2(v.x)}, ${fixed2(v.y)})`;
}

export function createControls({ pane, settings, hover, setHitVolume }: ControlsOptions): Controls {
  // The last hit raycast returned, not hover: with reuse off, each hit is a new object and hover is never filled.
  let last: RaycastHit3D | null = null;
  let returned = 'hover';
  let named: Container3D | null = null;
  let created = 0;
  const hitRows = {
    get returns() {
      return returned;
    },
    get target() {
      return last ? last.target.label : '';
    },
    get point() {
      return last ? vector3(last.point) : '';
    },
    // In the shape's own space: under a still pointer on a flat face, point holds while this moves across the shape.
    get localPoint() {
      return last ? vector3(last.localPoint) : '';
    },
    get distance() {
      return last ? fixed2(last.distance) : '';
    },
    // Zero for a 'box' hit, which has no triangle.
    get normal() {
      return last ? vector3(last.normal) : '';
    },
    get uv() {
      return last ? vector2(last.uv) : '';
    },
    get triangleIndex() {
      return last ? String(last.triangleIndex) : '';
    },
  };
  // Climbs by one a frame while the pick hits with Reuse hover off, and holds still with it on.
  const allocations = {
    get created() {
      return String(created);
    },
  };

  // The options sit at the top, under the theme, with no folder of their own, which keeps the pane short, so the ray
  // inset fits under it at full height on most screens.
  pane.addBinding(settings, 'reuseHover', { label: 'Reuse hover' });
  pane.addBinding(allocations, 'created', { ...MONITOR, label: 'hits created' });
  pane.addBinding(settings, 'turntable', { label: 'Turntable', min: 0, max: 0.6, step: 0.05 });
  pane
    .addBinding(settings, 'hitVolume', { options: { geometry: 'geometry', box: 'box' } })
    .on('change', ({ value }) => setHitVolume(value));

  const hitFolder = pane.addFolder({ title: 'hit' });

  hitFolder.addBinding(hitRows, 'returns', MONITOR);

  const fields = (['target', 'point', 'localPoint', 'distance', 'normal', 'uv', 'triangleIndex'] as const).map((key) =>
    hitFolder.addBinding(hitRows, key, MONITOR),
  );

  return {
    update(hit) {
      const now = hit === null ? 'null' : hit === hover ? 'hover' : 'a new object';

      if (hit && hit !== hover) created++;
      if (hit) last = hit;
      if (now === returned && (!hit || hit.target === named)) return;
      if (now !== returned) for (const row of fields) row.disabled = hit === null;
      returned = now;
      if (hit) named = hit.target;
      hitFolder.refresh();
    },
  };
}
