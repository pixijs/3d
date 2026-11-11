/**
 * What the frame draws to explain the environment: a tag under each probe ball naming what it shows of the light
 *
 * It never changes the scene, so `index.ts` runs the same without it.
 */

import type { View3D } from '@pixi/3d';
import type { Application } from 'pixi.js';

import { LabelLayer } from '../shared/theme/LabelLayer';
import type { ThemeStage } from '../shared/theme/ThemeStage';
import { PROBE_RADIUS } from './scene';
import type { Probes } from './scene';

export interface VisualsOptions {
  app: Application;
  view3d: View3D;
  stage: ThemeStage;
  probes: Probes;
}

export function createVisuals({ app, view3d, stage, probes }: VisualsOptions): { update(): void } {
  const labels = new LabelLayer({ view3d, stage });
  // Hung by their top edge under each ball's lowest point, so neither tag covers what its ball shows.
  const tag = { at: { x: 0, y: -PROBE_RADIUS, z: 0 }, anchor: { x: 0.5, y: 0 }, offset: { x: 0, y: 8 } };

  labels.add({ ...tag, text: 'reflections', node: probes.mirror });
  labels.add({ ...tag, text: 'soft light', node: probes.matte });
  app.stage.addChild(labels);

  return {
    update() {
      labels.update();
    },
  };
}
