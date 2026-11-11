/**
 * The split screen: two views of one scene side by side, or stacked on a portrait screen, that look and move as one
 *
 * Each half is a whole `View3D`, so each keeps its own `toneMapping`. The split sizes and places them, draws the line
 * between them, lets a drag on either half orbit the first view's camera, backs that camera off when a half is too
 * narrow for the subject, and copies the camera, the theme and the fog to the second view each tick, so the halves
 * differ only in what the lesson changes.
 */

import type { View3D } from '@pixi/3d';
import type { OrbitCamera } from '@pixi/3d/extras';
import { Rectangle } from 'pixi.js';
import type { Application } from 'pixi.js';

import { fitPortrait } from '../shared/theme/fitPortrait';
import { ScreenLines } from '../shared/theme/ScreenLines';
import type { ThemeStage } from '../shared/theme/ThemeStage';

/** The line between the halves: px wide, and how strongly it shows */
const DIVIDER = { width: 2, alpha: 0.5 };

export interface SplitViewOptions {
  app: Application;
  /** Left and right, or top and bottom on a portrait screen; the second copies the first's camera */
  views: readonly [View3D, View3D];
  /** Each view's stage; the second follows the first's theme and fog */
  stages: readonly [ThemeStage, ThemeStage];
  /** The orbit that drives the first view's camera */
  orbit: OrbitCamera;
  /** The narrowest half, width over height, that shows the subject whole from the landscape distance */
  minAspect: number;
}

export interface SplitView {
  /** Each view's rect on screen, in global px, rewritten on a resize */
  readonly halves: readonly [Rectangle, Rectangle];
  /** Whether the views are stacked, on a screen taller than it is wide */
  readonly stacked: boolean;
  /** The line between the halves: add it after the views */
  readonly divider: ScreenLines;
  /** Copies the first view's camera, theme and fog to the second; call it each tick once the orbit has moved */
  update(): void;
}

export function createSplitView({ app, views, stages, orbit, minAspect }: SplitViewOptions): SplitView {
  const [main, copy] = views;
  const [mainStage, copyStage] = stages;
  const halves = [new Rectangle(), new Rectangle()] as const;
  const divider = new ScreenLines({ stage: mainStage, width: DIVIDER.width, alpha: DIVIDER.alpha });
  let stacked = false;

  // One drag anywhere orbits: the first view spans both halves and draws only into its own, through its camera's
  // viewport, and the second, over the other half, lets the pointer through to it.
  copy.eventMode = 'none';

  function layout(): void {
    const { width, height } = app.screen;

    stacked = width < height;

    const half = Math.floor((stacked ? height : width) / 2);

    // The second half takes the odd px, so the halves tile the screen and differ in size by 1 px at most.
    if (stacked) {
      halves[0].set(0, 0, width, half);
      halves[1].set(0, half, width, height - half);
    } else {
      halves[0].set(0, 0, half, height);
      halves[1].set(half, 0, width - half, height);
    }
    main.setSize(width, height);
    main.camera.viewport.set(0, 0, halves[0].width / width, halves[0].height / height);
    copy.position.set(halves[1].x, halves[1].y);
    copy.setSize(halves[1].width, halves[1].height);
    divider.clear();
    if (stacked) divider.line(0, half, width, half);
    else divider.line(half, 0, half, height);
  }

  /** Gives the second view the first one's camera, theme and fog */
  function follow(): void {
    copy.camera.position.copyFrom(main.camera.position);
    copy.camera.quaternion.copyFrom(main.camera.quaternion);
    copy.camera.fov = main.camera.fov;
    if (copyStage.darkness !== mainStage.darkness) copyStage.darkness = mainStage.darkness;
    copyStage.fog.near = mainStage.fog.near;
    copyStage.fog.far = mainStage.fog.far;
  }

  layout();

  // After the first layout, so it measures the first view's camera viewport, a half.
  const fit = fitPortrait({ renderer: app.renderer, orbit, stage: mainStage, minAspect });

  // The halves have to be laid out before the fit measures them, so the split runs it on a resize, not the fit.
  fit.stop();
  app.renderer.on('resize', () => {
    layout();
    fit.refit();
    follow();
  });

  return {
    halves,
    get stacked() {
      return stacked;
    },
    divider,
    update() {
      follow();
      divider.update();
    },
  };
}
