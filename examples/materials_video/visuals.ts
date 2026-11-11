/**
 * What the frame draws to explain the shared video: a tag on each display naming how its material shades it
 *
 * It reads the scene each frame and never changes it, so `index.ts` runs the same without it.
 */

import type { Container3D, View3D } from '@pixi/3d';
import type { Application } from 'pixi.js';

import { LabelLayer } from '../shared/theme/LabelLayer';
import type { ThemeStage } from '../shared/theme/ThemeStage';

export interface VisualsOptions {
  app: Application;
  view3d: View3D;
  stage: ThemeStage;
  /** The unlit monitor, then the lit one, each with its origin at its screen's centre */
  displays: readonly Container3D[];
}

export function createVisuals({ app, view3d, stage, displays }: VisualsOptions): { update(): void } {
  const labels = new LabelLayer({ view3d, stage });

  labels.add({ text: 'unlit display', node: displays[0], at: { x: 0, y: 1.2, z: 0 } });
  labels.add({ text: 'lit display', node: displays[1], at: { x: 0, y: 1.2, z: 0 } });
  app.stage.addChild(labels);

  return {
    update() {
      labels.update();
    },
  };
}
