/**
 * What the frame draws to explain the coat: a tag under each sphere saying which one wears it
 *
 * It reads the scene each frame and never changes it, so `index.ts` runs the same without it.
 */

import type { Mesh3D, View3D } from '@pixi/3d';
import type { Application } from 'pixi.js';

import { LabelLayer } from '../shared/theme/LabelLayer';
import type { ThemeStage } from '../shared/theme/ThemeStage';

/** Px between a sphere's lowest point and its tag */
const TAG_GAP = 16;

export interface VisualsOptions {
  app: Application;
  view3d: View3D;
  stage: ThemeStage;
  /** The sphere wearing the paint, and its twin built without a coat */
  coatedSphere: Mesh3D;
  bareSphere: Mesh3D;
}

export function createVisuals({ app, view3d, stage, coatedSphere, bareSphere }: VisualsOptions): { update(): void } {
  const labels = new LabelLayer({ view3d, stage });
  // Pinned to the floor in front of each sphere, so they hang under it from any angle the orbit allows. The twins
  // share one geometry, so its box serves both.
  const { min, max } = coatedSphere.geometry.bounds3D;
  const under = { x: 0, y: min.y, z: max.z };
  const offset = { x: 0, y: TAG_GAP };

  labels.add({ text: 'clearcoat', node: coatedSphere, at: under, offset });
  labels.add({ text: 'no clearcoat', node: bareSphere, at: under, offset });
  app.stage.addChild(labels);

  return {
    update() {
      labels.update();
    },
  };
}
