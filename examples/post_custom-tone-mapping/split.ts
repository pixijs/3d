/**
 * The split screen: two views of one scene side by side, or stacked on a portrait screen, that look and move as one
 *
 * Each half is a whole `View3D`, so each runs its own graph and its own `DisplayEffect`. The split sizes and places
 * them, draws the line between them, lets a drag on either half orbit the first view's camera, backs that camera off
 * when a half is too narrow for the logo, and copies the camera, the theme and the fog to the second view each tick,
 * so the halves differ only in their effect.
 */

import type { View3D } from '@pixi/3d';
import type { OrbitCamera } from '@pixi/3d/extras';
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
  /** The line between the halves: add it after the views */
  readonly divider: ScreenLines;
  /** Copies the first view's camera, theme and fog to the second; call it each tick once the orbit has moved */
  update(): void;
}

export function createSplitView({ app, views, stages, orbit, minAspect }: SplitViewOptions): SplitView {
  const [main, copy] = views;
  const [mainStage, copyStage] = stages;
  const divider = new ScreenLines({ stage: mainStage, width: DIVIDER.width, alpha: DIVIDER.alpha });

  // One drag anywhere orbits: the first view spans both halves and draws only into its own, through its camera's
  // viewport, and the second, over the other half, lets the pointer through to it. A graph sizes its targets to the
  // camera's viewport, so each half shades only its own pixels.
  copy.eventMode = 'none';

  function layout(): void {
    const { width, height } = app.screen;
    const stacked = width < height;
    const half = Math.floor((stacked ? height : width) / 2);

    main.setSize(width, height);
    divider.clear();
    // The second half takes the odd px, so the halves tile the screen.
    if (stacked) {
      main.camera.viewport.set(0, 0, 1, half / height);
      copy.position.set(0, half);
      copy.setSize(width, height - half);
      divider.line(0, half, width, half);
    } else {
      main.camera.viewport.set(0, 0, half / width, 1);
      copy.position.set(half, 0);
      copy.setSize(width - half, height);
      divider.line(half, 0, half, height);
    }
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
    divider,
    update() {
      follow();
      divider.update();
    },
  };
}
