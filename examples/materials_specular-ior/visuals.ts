/**
 * What the frame draws to explain the row: each sphere's `ior`, under it
 *
 * It reads the scene each frame and never changes it, so `index.ts` runs the same without it.
 */

import { Vector3 } from '@pixi/3d';
import type { View3D } from '@pixi/3d';
import type { Application } from 'pixi.js';

import { LabelLayer } from '../shared/theme/LabelLayer';
import type { ThemeStage } from '../shared/theme/ThemeStage';
import { SAMPLE_IORS, SAMPLE_RADIUS, samplePosition } from './scene';

/**
 * How far under a sphere's centre its tag hangs, in radii: past the sphere's lowest edge on screen even from the
 * orbit's highest view, which sees the point under the sphere foreshortened
 */
const TAG_DROP = 1.3;

export interface VisualsOptions {
  app: Application;
  view3d: View3D;
  stage: ThemeStage;
}

export function createVisuals({ app, view3d, stage }: VisualsOptions): { update(): void } {
  const labels = new LabelLayer({ view3d, stage });
  const under = new Vector3();

  SAMPLE_IORS.forEach((ior, i) => {
    samplePosition(i, under).y -= SAMPLE_RADIUS * TAG_DROP;
    labels.add({ text: ior.toFixed(2), at: under, anchor: { x: 0.5, y: 0 }, offset: { x: 0, y: 0 } });
  });
  app.stage.addChild(labels);

  return {
    update() {
      labels.update();
    },
  };
}
