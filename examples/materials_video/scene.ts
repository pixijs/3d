/** Two matching monitors side by side, floating over the floor, each showing the clip through its own material */

import type { Container3D, FlatMaterial, Material3D } from '@pixi/3d';

import { createMonitor } from '../shared/theme/monitor';

/** Screen width; its height follows the clip's aspect, so the frame isn't stretched */
const SCREEN_WIDTH = 3.1;
/** Height of the screen's centre above the floor, enough that each monitor's shadow lands clear below it */
const SCREEN_Y = 1.8;
/** How far each monitor sits from the middle, leaving a gap between the two bezels */
const MONITOR_X = 1.9;

/**
 * Builds one monitor per material, the first on the left, and returns their roots; both screens are the same size,
 * so the shared clip lands on each the same way
 */
export function createDisplays(
  parent: Container3D,
  materials: readonly (FlatMaterial | Material3D)[],
  aspect: number,
): Container3D[] {
  return materials.map((material, i) => {
    // A video stores its top row first, so the screen flips v to show it upright.
    const { root } = createMonitor({ material, width: SCREEN_WIDTH, aspect, flipV: true });

    root.position.set(i === 0 ? -MONITOR_X : MONITOR_X, SCREEN_Y, 0);
    parent.addChild(root);

    return root;
  });
}
