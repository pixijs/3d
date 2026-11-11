/**
 * What the frame draws to explain the stamp: a ring on the tablet at the pointer's hit, as wide as the next stamp
 *
 * It reads the scene each frame and never changes it, so `index.ts` runs the same without it.
 */

import type { PointData3D, View3D } from '@pixi/3d';

import { RingHelper } from '../shared/theme/RingHelper';

/** Lifts the ring over the marks, so it draws on top of the one it rings */
const RING_LIFT = 0.014;

export interface VisualsOptions {
  view3d: View3D;
  /** The pointer's last hit on the tablet, held in from the edges, starting on the newest opening mark */
  aim: PointData3D;
  /** The next stamp's size, which is the ring's width */
  settings: { size: number };
}

export function createVisuals({ view3d, aim, settings }: VisualsOptions): { update(): void } {
  const ring = new RingHelper({ parent: view3d.root, radius: settings.size / 2, thickness: 0.025, color: 'accent' });

  return {
    update() {
      ring.radius = settings.size / 2;
      ring.position.set(aim.x, aim.y + RING_LIFT, aim.z);
    },
  };
}
