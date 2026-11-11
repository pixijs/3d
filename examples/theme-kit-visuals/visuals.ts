/**
 * What the gallery draws: every teaching visual in the kit on its station, each named by a tag, and the 2D overlays
 *
 * It reads the scene each frame and never changes it, so `index.ts` runs the same without it. Each visual comes back
 * as a GalleryVisual, which the pane shows or hides by name.
 */

import type { Container3D, View3D } from '@pixi/3d';
import type { Application, Container, Rectangle } from 'pixi.js';

import type { Label } from '../shared/theme/Label';
import { LabelLayer } from '../shared/theme/LabelLayer';
import type { ThemeStage } from '../shared/theme/ThemeStage';
import { createHelperVisuals } from './helperVisuals';
import type { ScreenShape } from './layouts';
import { createMeshVisuals } from './meshVisuals';
import { createNameTags } from './nameTags';
import { createOverlayVisuals } from './overlayVisuals';
import type { GalleryScene } from './scene';

/** The pane folder a visual's row sits in */
export type VisualGroup = 'Helpers' | 'Lines and points' | 'Mesh and scene' | 'Overlays';

/** One visual in the gallery, which the pane shows or hides */
export interface GalleryVisual {
  /** Its class name, as its tag and its pane row show it */
  readonly name: string;
  readonly group: VisualGroup;
  /** Shows or hides it and its name tag */
  show(shown: boolean): void;
}

/** A few visuals built together, and their per-frame code */
export interface VisualSet {
  readonly visuals: GalleryVisual[];
  update(dt: number): void;
}

export interface VisualsOptions {
  app: Application;
  view3d: View3D;
  stage: ThemeStage;
  scene: GalleryScene;
  /**
   * How much thicker the helpers' lines are than on a wide screen: a phone frames the gallery from further back, where
   * the wide lines would fall under a pixel
   */
  widen: number;
}

export interface GalleryVisuals {
  readonly visuals: GalleryVisual[];
  /** Follows the scene; call it once the scene has moved */
  update(dt: number): void;
  /** Sizes the inset for the screen as it is now and returns the rect it covers; call it on each resize */
  arrange(shape: ScreenShape): Rectangle;
}

/** A visual whose parts show and hide together with its name tag; the inset's title is its name, so it has none */
export function visual(
  name: string,
  group: VisualGroup,
  parts: readonly (Container | Container3D)[],
  tag: Label | null,
): GalleryVisual {
  return {
    name,
    group,
    show(shown) {
      for (const part of parts) part.visible = shown;
      if (tag) tag.hidden = !shown;
    },
  };
}

export function createVisuals({ app, view3d, stage, scene, widen }: VisualsOptions): GalleryVisuals {
  const labels = new LabelLayer({ view3d, stage });
  const tags = createNameTags(labels, scene);
  // The overlays place the inset's camera, so they update before the frustum that draws it.
  const overlays = createOverlayVisuals({ app, view3d, stage, scene, tags });
  const sets: VisualSet[] = [
    createHelperVisuals(scene, tags, widen),
    overlays,
    createMeshVisuals({ camera: view3d.camera, lens: overlays.lens, scene, tags, widen }),
  ];
  const labelLayer = visual('LabelLayer', 'Overlays', [labels], tags.add('mark', 'LabelLayer'));

  // The inset draws over the name tags.
  app.stage.addChild(labels, overlays.layer);

  return {
    visuals: [...sets.flatMap((set) => set.visuals), labelLayer],
    update(dt) {
      for (const set of sets) set.update(dt);
      labels.update();
    },
    arrange(shape) {
      return overlays.arrange(shape);
    },
  };
}
