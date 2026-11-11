/**
 * What the frame draws to explain glass and liquid: a tag on each, named like the pane folder that sets it
 *
 * It reads the scene each frame and never changes it, so `index.ts` runs the same without it.
 */

import type { Container3D, View3D } from '@pixi/3d';
import type { Application } from 'pixi.js';

import { LabelLayer } from '../shared/theme/LabelLayer';
import type { PixiLogo } from '../shared/theme/logo';
import type { ThemeStage } from '../shared/theme/ThemeStage';
import { BOTTLE_WIDTH } from './scene';

/** Each tag hangs below a point on the floor at its subject's front, where the bars behind never reach it */
const FLOOR_TAG = { anchor: { x: 0.5, y: 0 }, offset: { x: 0, y: 6 } };

export interface VisualsOptions {
  app: Application;
  view3d: View3D;
  stage: ThemeStage;
  logo: PixiLogo;
  /** The bottle's root, on the floor at its centre line */
  bottle: Container3D;
}

export function createVisuals({ app, view3d, stage, logo, bottle }: VisualsOptions): { update(): void } {
  const labels = new LabelLayer({ view3d, stage });
  const { x, z } = logo.root.position;

  labels.add({ text: 'glass', at: { x, y: 0, z: z + logo.half.z }, ...FLOOR_TAG });
  labels.add({ text: 'liquid', node: bottle, at: { x: 0, y: 0, z: BOTTLE_WIDTH / 2 }, ...FLOOR_TAG });
  app.stage.addChild(labels);

  return {
    update() {
      labels.update();
    },
  };
}
