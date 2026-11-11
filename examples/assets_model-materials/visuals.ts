/**
 * What the frame draws to explain materials per model: a tag over each helmet saying whether it draws the source's
 * shared material or a copy of its own
 *
 * It reads the scene each frame and never changes it, so `index.ts` runs the same without it.
 */

import type { Model3D, Scene3DSource, View3D } from '@pixi/3d';
import type { Application } from 'pixi.js';

import type { Label } from '../shared/theme/Label';
import { LabelLayer } from '../shared/theme/LabelLayer';
import type { ThemeStage } from '../shared/theme/ThemeStage';

/** Each tag's point in its helmet's space: just over the crown, which stays put as the helmet sways */
const CROWN = { x: 0, y: 1.15, z: 0 };

export interface VisualsOptions {
  app: Application;
  view3d: View3D;
  stage: ThemeStage;
  /** The file the helmets were built from */
  source: Scene3DSource;
  helmets: readonly Model3D[];
}

export function createVisuals({ app, view3d, stage, source, helmets }: VisualsOptions): { update(): void } {
  const labels = new LabelLayer({ view3d, stage });
  const tags: Label[] = helmets.map((helmet) => labels.add({ text: '', node: helmet, at: CROWN }));

  app.stage.addChild(labels);

  return {
    update() {
      // A model whose `materials` is the source's own list draws the shared ones; any other list is its own.
      for (let i = 0; i < helmets.length; i++) {
        const own = helmets[i].materials !== source.materials;

        tags[i].text = own ? 'own copy' : 'shared';
        tags[i].color = own ? 'accent' : null;
      }
      labels.update();
    },
  };
}
