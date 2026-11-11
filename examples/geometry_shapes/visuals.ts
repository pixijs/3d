/**
 * What the frame draws to explain the built-in shapes: the hero's triangles as a wireframe, its axes and size marks,
 * and a tag naming each swatch
 *
 * It reads the scene each frame and never changes it, so `index.ts` runs the same without it. Whenever the hero gets a
 * new geometry it outlines the new triangles and lays the marks out again. `measures.ts` says what each class's
 * options measure, and `marks.ts` draws and tags the marks.
 */

import { Vector3 } from '@pixi/3d';
import type { Geometry3D, Mesh3D, View3D } from '@pixi/3d';
import type { Application } from 'pixi.js';
import { Point } from 'pixi.js';

import { LabelLayer } from '../shared/theme/LabelLayer';
import { CLAY } from '../shared/theme/palette';
import type { ThemeStage } from '../shared/theme/ThemeStage';
import { WireframeHelper } from '../shared/theme/WireframeHelper';
import { createMarks } from './marks';
import { placeMeasures } from './measures';
import { optionsOf, SHAPE_COLORS, SHAPES } from './scene';
import type { Catalogue, ShapeOptions, ShapeState } from './scene';

/** Px from a swatch's floor point down to its tag, and the least gap between two tags */
const SWATCH_TAG_DROP = 14;
const SWATCH_TAG_GAP = 4;

export interface VisualsOptions {
  app: Application;
  view3d: View3D;
  stage: ThemeStage;
  /** The big shape in the middle, drawing the selected class */
  hero: Mesh3D;
  swatches: Catalogue;
  /** Every class's options, which the pane writes */
  options: ShapeOptions;
  state: Readonly<ShapeState>;
}

const _world = new Vector3();
const _screen = new Point();

export function createVisuals({ app, view3d, stage, hero, swatches, options, state }: VisualsOptions): {
  update(): void;
} {
  // The fit grows the view past a phone's screen, so the tags keep to the screen itself.
  const labels = new LabelLayer({ view3d, stage, bounds: app.screen });
  // Outlined by the first update, like every geometry after it.
  const wire = new WireframeHelper({ parent: hero });
  const marks = createMarks({ hero, view3d, labels });
  const swatchTags = SHAPES.map((shape) => {
    const { x, z } = swatches.meshes[shape].position;
    const text = shape.slice(0, -'Geometry'.length);

    return labels.add({ text, node: swatches.root, at: { x, y: 0, z }, offset: { x: 0, y: SWATCH_TAG_DROP } });
  });
  let shown: Geometry3D | null = null;

  app.stage.addChild(labels);

  /** Outlines the hero's new geometry, lays out its class's marks, and colours the selected swatch's tag */
  function show(): void {
    wire.rebuild(hero.geometry.positions, hero.geometry.indices, hero.geometry.normals);
    placeMeasures({ marks, hero, camera: view3d.camera, shape: state.shape, values: optionsOf(options, state.shape) });
    for (let i = 0; i < SHAPES.length; i++) {
      swatchTags[i].color = SHAPES[i] === state.shape ? CLAY[SHAPE_COLORS[state.shape]] : null;
    }
    shown = hero.geometry;
  }

  /**
   * Hides each swatch tag whose box would cross the screen's edge, so none is cut off as the row slides. On a screen
   * too short for the tags to sit side by side, only the selected swatch keeps its tag.
   */
  function placeSwatchTags(): void {
    const { left, right } = app.screen;
    let lastRight = -Infinity;
    let crowded = false;

    for (const tag of swatchTags) {
      const point = view3d.worldToScreen(swatches.root.toGlobal(tag.at, _world), _screen);
      const half = tag.width / 2;
      const fits = point !== null && point.x - half >= left + labels.margin && point.x + half <= right - labels.margin;

      tag.hidden = !fits;
      if (!fits) continue;
      crowded ||= point.x - half < lastRight + SWATCH_TAG_GAP;
      lastRight = point.x + half;
    }
    for (let i = 0; crowded && i < SHAPES.length; i++) {
      if (SHAPES[i] !== state.shape) swatchTags[i].hidden = true;
    }
  }

  return {
    update() {
      if (hero.geometry !== shown) show();
      wire.visible = state.wireframe;
      marks.update();
      placeSwatchTags();
      labels.update();
    },
  };
}
