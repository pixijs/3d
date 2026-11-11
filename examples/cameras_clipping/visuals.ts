/**
 * What the frame draws to explain clipping: each sphere's distance down the view direction, so a reader can match
 * the pane's near and far to the sphere they cut
 *
 * It reads the scene each frame and never changes it, so `index.ts` runs the same without it.
 */

import type { Mesh3D, View3D } from '@pixi/3d';
import type { Application } from 'pixi.js';

import { LabelLayer } from '../shared/theme/LabelLayer';
import type { ThemeStage } from '../shared/theme/ThemeStage';

/** Below this screen width neighbouring tags would overlap, so every other one lifts into a second row */
const NARROW_WIDTH = 600;
/** How far the second row sits above the first, in px, so its tags clear their neighbours */
const SECOND_ROW = 44;

export interface VisualsOptions {
  app: Application;
  view3d: View3D;
  stage: ThemeStage;
  /** The spheres, nearest first */
  spheres: Mesh3D[];
  /** Each sphere's distance down the camera's view direction */
  distances: number[];
}

export function createVisuals({ app, view3d, stage, spheres, distances }: VisualsOptions): { update(): void } {
  const labels = new LabelLayer({ view3d, stage });
  // A tag stays when the planes clip its sphere away, marking where the sphere would be.
  const tags = spheres.map((node, i) => labels.add({ text: `${distances[i]} units`, node, at: { x: 0, y: 1, z: 0 } }));

  app.stage.addChild(labels);

  return {
    update() {
      const narrow = app.screen.width < NARROW_WIDTH;

      for (let i = 0; i < tags.length; i++) {
        tags[i].offset.y = narrow && i % 2 === 1 ? -18 - SECOND_ROW : -18;
      }
      labels.update();
    },
  };
}
