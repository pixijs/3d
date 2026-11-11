/**
 * What the frame draws to explain the split: each half's name under its logo
 *
 * The labels are pixi 2D drawn after the views, outside both graphs, so no curve or encode touches them. It reads the
 * scene each frame and never changes it, so `index.ts` runs the same without it.
 */

import type { View3D } from '@pixi/3d';
import type { Application } from 'pixi.js';

import { LabelLayer } from '../shared/theme/LabelLayer';
import type { PixiLogo } from '../shared/theme/logo';
import type { ThemeStage } from '../shared/theme/ThemeStage';

/** A name hangs from the bottom of its logo's turning axis, this many px below, so it stays put while the logo sways */
const NAME_GAP = 14;

export interface VisualsOptions {
  app: Application;
  /** The half with the curve off, then the half with it on */
  views: readonly [View3D, View3D];
  /** Each half's logo, in the views' order */
  logos: readonly [PixiLogo, PixiLogo];
  /** Where the labels read the theme from */
  stage: ThemeStage;
}

/** A layer over one half with the half's name under its logo */
function createName(view3d: View3D, stage: ThemeStage, logo: PixiLogo, text: string): LabelLayer {
  const labels = new LabelLayer({ view3d, stage });

  labels.add({
    text,
    node: logo.root,
    at: { x: 0, y: -logo.half.y, z: 0 },
    anchor: { x: 0.5, y: 0 },
    offset: { x: 0, y: NAME_GAP },
  });

  return labels;
}

export function createVisuals({ app, views, logos, stage }: VisualsOptions): { update(): void } {
  const clipLabels = createName(views[0], stage, logos[0], 'no curve');
  const curveLabels = createName(views[1], stage, logos[1], 'Reinhard');

  app.stage.addChild(clipLabels, curveLabels);

  return {
    update() {
      clipLabels.update();
      curveLabels.update();
    },
  };
}
