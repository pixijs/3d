/**
 * What the frame draws to explain the projection: an arrow for the direction the cloud is projected along
 *
 * It reads the scene each frame and never changes it, so `index.ts` runs the same without it. Mesh UV projects
 * nothing, so the arrow hides while that space is picked.
 */

import type { View3D } from '@pixi/3d';
import type { Application } from 'pixi.js';

import { ArrowHelper } from '../shared/theme/ArrowHelper';
import { LabelLayer } from '../shared/theme/LabelLayer';
import type { ThemeStage } from '../shared/theme/ThemeStage';

export interface VisualsOptions {
  app: Application;
  view3d: View3D;
  stage: ThemeStage;
  /** The pane's settings; `space` is 'World xz' or 'Mesh UV' */
  settings: { space: string };
}

export function createVisuals({ app, view3d, stage, settings }: VisualsOptions): { update(): void } {
  const labels = new LabelLayer({ view3d, stage, bounds: app.screen });
  // Above the torus and stopping short of it, so it points down over the whole scene without crossing a mesh.
  const arrow = new ArrowHelper({ parent: view3d.root, color: 'accent', thickness: 0.035 });
  const label = labels.add({ text: 'projected along −y', at: { x: 0, y: 3.35, z: -1 } });

  arrow.set({ x: 0, y: 3.3, z: -1 }, { x: 0, y: 1.4, z: -1 });
  app.stage.addChild(labels);

  return {
    update() {
      const projected = settings.space === 'World xz';

      arrow.visible = projected;
      label.hidden = !projected;
      labels.update();
    },
  };
}
