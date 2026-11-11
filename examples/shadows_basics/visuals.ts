/**
 * What the frame draws to explain shadows: two light rays the logo blocks (rays.ts), the spot's lamp, the name of the
 * light that's on, where too much bias lifts the sphere's shadow, and the loupe on the shadow's edge (loupe.ts)
 *
 * It reads the scene each frame and never changes it, so `index.ts` runs the same without it.
 */

import type { DirectionalLight, Mesh3D, SpotLight, View3D } from '@pixi/3d';
import { Vector3 } from '@pixi/3d';
import type { Application } from 'pixi.js';

import type { InsetView } from '../shared/theme/InsetView';
import { LabelLayer } from '../shared/theme/LabelLayer';
import { LightHelper } from '../shared/theme/LightHelper';
import type { PixiLogo } from '../shared/theme/logo';
import { NARROW_BELOW } from '../shared/theme/overlay';
import type { Corner } from '../shared/theme/overlay';
import type { ThemeStage } from '../shared/theme/ThemeStage';
import { createLoupe } from './loupe';
import { createShadowRays } from './rays';

/** The lamp's line width: thicker on a phone, which sees it from further back */
const LAMP_LINE = { wide: 0.02, narrow: 0.04 };
/** The lamp's cone, along its axis: long enough to read as a cone, short enough to end above the wall */
const LAMP_LENGTH = 0.3;
/**
 * The sun's bias from which the sphere's contact shadow visibly lets go of its foot. Under the spot that shadow falls
 * behind the sphere, out of sight, so the tag shows only under the sun.
 */
const PETER_PANNING = 0.02;

export interface VisualsOptions {
  app: Application;
  view3d: View3D;
  stage: ThemeStage;
  sun: DirectionalLight;
  spot: SpotLight;
  logo: PixiLogo;
  /** The wall the logo's shadow falls on */
  wall: Mesh3D;
  /** The plinth the props stand on */
  plinth: Mesh3D;
  /** The prop whose contact shadow shows peter-panning */
  sphere: Mesh3D;
  /** Where the loupe docks on a screen 600 px wide or more */
  loupeCorner: Corner;
}

export interface Visuals {
  /** The loupe's panel, for the pane's place on a short screen and the band the scene clears on a narrow one */
  readonly loupe: InsetView;
  update(dt: number): void;
}

export function createVisuals(options: VisualsOptions): Visuals {
  const { app, view3d, stage, sun, spot, logo, wall, plinth, sphere, loupeCorner } = options;
  const rays = createShadowRays({ sun, spot, logo, wall, plinth, parent: view3d.root });
  // Under the root, not the spot, so it doesn't hide with it.
  const lamp = new LightHelper({ light: spot, length: LAMP_LENGTH, color: 'ink', parent: view3d.root });
  const loupe = createLoupe({ app, view3d, stage, corner: loupeCorner });
  // Bound to the screen, since a narrow screen's fit grows the view past it.
  const labels = new LabelLayer({ view3d, stage, bounds: app.screen });
  const loupeTarget = new Vector3();
  const lightTag = labels.add({ text: 'sun' });
  const peterTag = labels.add({
    text: 'peter-panning',
    color: 'accent',
    // On the gap: the plinth's top just right of the sphere's foot, where its shadow lets go. The tag sits off to the
    // right, on the plinth's top, so it hides neither the gap nor the plinth's edge.
    at: {
      x: sphere.position.x + 0.6,
      y: plinth.position.y + plinth.geometry.bounds3D.max.y,
      z: sphere.position.z - 0.1,
    },
    anchor: { x: 0, y: 0.5 },
    offset: { x: 24, y: 0 },
    leader: true,
  });

  app.stage.addChild(loupe.outline, labels, loupe.inset);

  return {
    loupe: loupe.inset,
    update(dt) {
      const narrow = app.screen.width < NARROW_BELOW;

      rays.update(narrow, loupeTarget);
      lamp.visible = spot.visible;
      lamp.thickness = narrow ? LAMP_LINE.narrow : LAMP_LINE.wide;
      lamp.update();

      // Over the sun's rays' tail, or up left of the spot's lamp, clear of its cone.
      lightTag.text = sun.visible ? 'sun' : 'spot';
      lightTag.at.copyFrom(sun.visible ? rays.left.from : lamp.tail);
      lightTag.offset.set(sun.visible ? 0 : -24, -22);
      // An unset bias is the engine's 0.001, under the threshold.
      peterTag.hidden = !sun.visible || !sun.castShadow || (sun.shadow.bias ?? 0) < PETER_PANNING;

      loupe.update(dt, loupeTarget);
      labels.update();
    },
  };
}
