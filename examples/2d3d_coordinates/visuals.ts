/**
 * What the frame draws to explain the crossings between the two spaces: a pin under each name tag at the pixel
 * worldToScreen gave it, the ring where the pointer aims, and the side view
 *
 * It reads the scene each frame and never changes it, so `index.ts` runs the same without it.
 */

import { Vector3 } from '@pixi/3d';
import type { Ray, View3D } from '@pixi/3d';
import type { OrbitCamera } from '@pixi/3d/extras';
import type { Application, Container, Point } from 'pixi.js';

import { RingHelper } from '../shared/theme/RingHelper';
import { ScreenLines } from '../shared/theme/ScreenLines';
import type { ThemeStage } from '../shared/theme/ThemeStage';
import type { Piece } from './scene';
import { createSideView } from './sideView';

/** A pin's dot radius, in px */
const PIN = 3;

/** What the pointer aims at this frame */
export interface Aim {
  /** The ray from the camera through the pointer */
  readonly ray: Ray;
  /** The point on it the pane picks: on the floor, or at a distance */
  readonly point: Vector3;
  /** `false` when the ray misses the floor */
  hit: boolean;
}

export interface VisualsOptions {
  app: Application;
  view3d: View3D;
  stage: ThemeStage;
  orbit: OrbitCamera;
  /** The pointer, in global px */
  pointer: Point;
  aim: Aim;
  /** Every piece with a name tag */
  pieces: readonly Piece[];
  /** The piece whose line back to the camera the side view draws */
  pyramid: Piece;
  params: { readonly labelOffset: number; readonly dropOn: 'floor' | 'distance'; readonly distance: number };
  /** The name tags' container: the pins draw just under it */
  tagLayer: Container;
}

const UP = { x: 0, y: 1, z: 0 };
const _facing = new Vector3();

export function createVisuals(options: VisualsOptions): { update(dt: number): void } {
  const { app, view3d, stage, orbit, pointer, aim, pieces, pyramid, params, tagLayer } = options;
  const pins = new ScreenLines({ stage });
  const ring = new RingHelper({ radius: 0.32, thickness: 0.04, parent: view3d.root });
  const side = createSideView({ app, view3d, stage, orbit, pointer, aim, pyramid, params });

  // Under the name tags, so a pin's stem ends at its text; the side view over everything.
  app.stage.addChildAt(pins, app.stage.getChildIndex(tagLayer));
  app.stage.addChild(side.inset);

  /** A pin under every tag: a dot on the pixel worldToScreen gave it, and a stem up the tag's lift to its text */
  function drawPins(): void {
    pins.clear().style('ink', 1.5);
    for (const { tag } of pieces) {
      if (tag.visible) pins.line(tag.x, tag.y, tag.x, tag.y - params.labelOffset + 2).dot(tag.x, tag.y, PIN);
    }
    pins.update();
  }

  return {
    update(dt) {
      // Under the floor, where ray.at can put it, the ring shows through the checks, muted.
      const sunk = params.dropOn === 'distance' && aim.point.y < 0;

      ring.visible = aim.hit;
      ring.xray = ring.muted = sunk;
      // Flat on the floor, or standing up to face the camera at a point in the air.
      ring.place(aim.point, params.dropOn === 'floor' ? UP : aim.ray.direction.negate(_facing));
      drawPins();
      side.update(dt);
    },
  };
}
