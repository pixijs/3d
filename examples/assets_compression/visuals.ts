/**
 * What the frame draws to name each encoding: a tag on the floor in front of each model
 *
 * It reads the scene each frame and never changes it, so `index.ts` runs the same without it.
 */

import type { View3D } from '@pixi/3d';
import type { Application } from 'pixi.js';

import { LabelLayer } from '../shared/theme/LabelLayer';
import type { ThemeStage } from '../shared/theme/ThemeStage';
import type { Slot } from './scene';

/** Px between the floor in front of a model and its tag */
const TAG_GAP = 12;

export interface VisualsOptions {
  app: Application;
  view3d: View3D;
  stage: ThemeStage;
  /** Each file's encoding and where its model stands */
  files: readonly { tag: string; slot: Slot }[];
}

export function createVisuals({ app, view3d, stage, files }: VisualsOptions): { update(): void } {
  const labels = new LabelLayer({ view3d, stage, bounds: app.screen });
  const offset = { x: 0, y: TAG_GAP };

  // On the floor at the front of the sphere each model is scaled to, in the root rather than on the turning stand,
  // so a tag holds still while its model sways.
  for (const { tag, slot } of files) {
    labels.add({ text: tag, at: { x: slot.x, y: 0, z: slot.z + slot.radius }, offset });
  }
  app.stage.addChild(labels);

  return {
    update() {
      labels.update();
    },
  };
}
