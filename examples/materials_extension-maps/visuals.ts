/**
 * What the frame draws to explain extension maps: a label naming each side of the comparison
 *
 * It reads the scene each frame and never changes it, so `index.ts` runs the same without it.
 */

import type { Mesh3D, View3D } from '@pixi/3d';
import type { Application } from 'pixi.js';

import { LabelLayer } from '../shared/theme/LabelLayer';
import type { ThemeStage } from '../shared/theme/ThemeStage';

export interface VisualsOptions {
  app: Application;
  view3d: View3D;
  stage: ThemeStage;
  /** The sphere whose material has the extension's plain values only */
  plainSphere: Mesh3D;
  /** The sphere whose material adds the extension's maps, or wears the plain one while Maps is off */
  mappedSphere: Mesh3D;
}

export function createVisuals({ app, view3d, stage, plainSphere, mappedSphere }: VisualsOptions): { update(): void } {
  const labels = new LabelLayer({ view3d, stage });

  labels.add({ text: 'plain values', node: plainSphere, at: { x: 0, y: 1.35, z: 0 } });
  const mappedLabel = labels.add({ text: 'texture maps', node: mappedSphere, at: { x: 0, y: 1.35, z: 0 } });

  app.stage.addChild(labels);

  return {
    update() {
      // With Maps off the right sphere wears the left one's material, so it takes the same name.
      mappedLabel.text = mappedSphere.material === plainSphere.material ? 'plain values' : 'texture maps';
      labels.update();
    },
  };
}
