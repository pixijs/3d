/**
 * What the frame draws to explain ribbons: a tag naming each ribbon's width units, and, when the pane asks, a dot at
 * every point the pink ribbon runs through
 *
 * It reads the scene each frame and never changes it, so `index.ts` runs the same without it.
 */

import type { View3D } from '@pixi/3d';
import type { Application } from 'pixi.js';

import { LabelLayer } from '../shared/theme/LabelLayer';
import { PointsHelper } from '../shared/theme/PointsHelper';
import type { ThemeStage } from '../shared/theme/ThemeStage';
import { FIRST_TURN_LEFT, FIRST_TURN_RIGHT } from './scene';

/** A dot's radius: half the default width, so each dot sits on the strip without hiding it */
const POINT_RADIUS = 0.035;
/** How far from its point each tag sits, in px, clear of the strip at its widest */
const TAG_GAP = 20;

export interface VisualsOptions {
  app: Application;
  view3d: View3D;
  stage: ThemeStage;
  /** The points of the ribbon whose width is in world units, x, y and z for each */
  worldPoints: Float32Array;
  /** The points of the ribbon whose width is in pixels */
  pixelPoints: Float32Array;
}

/** The frame's update, and the pane's switch for the dots */
export interface Visuals {
  showPoints: boolean;
  update(): void;
}

export function createVisuals({ app, view3d, stage, worldPoints, pixelPoints }: VisualsOptions): Visuals {
  const labels = new LabelLayer({ view3d, stage });
  // Each tag sits on the outer side of its ribbon's nearest turn, where the two widths still match best, clear of
  // the turns behind it.
  const pointAt = (points: Float32Array, index: number) => ({
    x: points[index * 3],
    y: points[index * 3 + 1],
    z: points[index * 3 + 2],
  });

  labels.add({
    text: "widthUnits: 'world'",
    at: pointAt(worldPoints, FIRST_TURN_LEFT),
    anchor: { x: 1, y: 0.5 },
    offset: { x: -TAG_GAP, y: 0 },
  });
  labels.add({
    text: "widthUnits: 'pixels'",
    at: pointAt(pixelPoints, FIRST_TURN_RIGHT),
    anchor: { x: 0, y: 0.5 },
    offset: { x: TAG_GAP, y: 0 },
  });

  const dots = new PointsHelper({ positions: worldPoints, radius: POINT_RADIUS, color: 'ink', parent: view3d.root });

  app.stage.addChild(labels);

  const visuals: Visuals = {
    showPoints: false,
    update() {
      dots.visible = visuals.showPoints;
      labels.update();
    },
  };

  return visuals;
}
