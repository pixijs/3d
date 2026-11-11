/**
 * What the frame draws to explain lines and points: the undrawn rest of the path as a ghost, a dot on vertex 0 and on
 * the last vertex drawn, and a close-up of vertex 0
 *
 * It reads the scene each frame and never changes it, so `index.ts` runs the same without it. On a screen taller than
 * wide it moves the framing clear of the close-up, through `fit`.
 */

import { Mesh3D, Vector3 } from '@pixi/3d';
import type { Geometry3D, Material3D, View3D } from '@pixi/3d';
import type { Application } from 'pixi.js';

import type { PortraitFit } from '../shared/theme/fitPortrait';
import { helperMaterial } from '../shared/theme/helpers';
import { LabelLayer } from '../shared/theme/LabelLayer';
import { PointsHelper } from '../shared/theme/PointsHelper';
import type { ThemePane } from '../shared/theme/ThemePane';
import type { ThemeStage } from '../shared/theme/ThemeStage';
import { createCloseUp } from './closeUp';
import { FIT_ASPECT } from './scene';
import type { PathTopology } from './scene';

/**
 * The ghost's opacity: a 1 px line needs more than the kit's 0.22 to show on the checks, while 1 px dots need far less
 * and must read paler than the drawn pink ones
 */
const GHOST_OPACITY: Record<PathTopology, number> = { 'line-list': 0.45, 'point-list': 0.15 };
/** The start and tip dots' radii: about half the 0.1 between vertices, so the tip clears the start dot past vertex 1 */
const START_RADIUS = 0.045;
const TIP_RADIUS = 0.05;
/**
 * Where the `vertex 0` tag sits: left of its dot, clear of the path, which leaves the dot heading up and down the
 * screen; inside the left lobe on a screen narrower than `FIT_ASPECT`, where the path spans it and the dot is too near
 * its left edge
 */
const START_TAG = {
  wide: { anchor: { x: 1, y: 0.5 }, offset: { x: -12, y: 0 } },
  narrow: { anchor: { x: 0, y: 0.5 }, offset: { x: 12, y: 0 } },
};

export interface VisualsOptions {
  app: Application;
  view3d: View3D;
  stage: ThemeStage;
  /** The figure-eight */
  path: Mesh3D;
  /** The path's geometries; a fixed one ignores `indexCount`, so it draws the whole path for the ghost */
  paths: Readonly<Record<PathTopology, { readonly fixed: Geometry3D }>>;
  /** The pane, with its rows: the close-up docks under it */
  pane: ThemePane;
  /** The scene's framing, which the close-up sets to keep clear of it on a screen taller than wide */
  fit: PortraitFit;
}

/** The frame's update */
export interface Visuals {
  update(dt: number): void;
}

export function createVisuals({ app, view3d, stage, path, paths, pane, fit }: VisualsOptions): Visuals {
  const positions = path.geometry.positions;
  // The path only ever draws as one of the two list topologies `index.ts` builds it in.
  const topologyNow = (): PathTopology => path.geometry.topology as PathTopology;
  // The screen, not the view: on a phone fitPortrait grows the view past it.
  const labels = new LabelLayer({ view3d, stage, bounds: app.screen });
  const ghost = new Mesh3D({ geometry: paths[topologyNow()].fixed, material: ghostLook(), parent: view3d.root });
  // Points rather than meshes, since they draw in the main view only; the close-up draws its own, smooth at its size.
  const start = new PointsHelper({ positions, capacity: 1, radius: START_RADIUS, parent: view3d.root });
  const tip = new PointsHelper({ positions, capacity: 1, radius: TIP_RADIUS, color: 'accent', parent: view3d.root });
  const tipAt = new Vector3();
  const startTag = labels.add({ text: 'vertex 0', at: { x: positions[0], y: positions[1], z: positions[2] } });
  const closeUp = createCloseUp({
    app,
    view3d,
    stage,
    positions,
    pane,
    fit,
    startRadius: START_RADIUS,
    tipRadius: TIP_RADIUS,
  });
  let shownTopology = topologyNow();
  let narrow: boolean | null = null;

  app.stage.addChild(closeUp.panel, labels);

  /** The ghost's material for the path's topology; helper materials are cached, so a swap allocates nothing */
  function ghostLook(): Material3D {
    return helperMaterial('ink', GHOST_OPACITY[topologyNow()]);
  }

  return {
    update(dt) {
      const { indices, dynamic } = path.geometry;
      const topology = topologyNow();
      // A geometry that isn't dynamic ignores `indexCount` and draws every index.
      const last = indices[(dynamic && path.geometry.indexCount ? path.geometry.indexCount : indices.length) - 1];

      if (narrow !== app.screen.width < app.screen.height * FIT_ASPECT) {
        narrow = app.screen.width < app.screen.height * FIT_ASPECT;

        const spot = narrow ? START_TAG.narrow : START_TAG.wide;

        startTag.anchor.copyFrom(spot.anchor);
        startTag.offset.copyFrom(spot.offset);
      }
      if (topology !== shownTopology) {
        shownTopology = topology;
        ghost.geometry = paths[topology].fixed;
        ghost.material = ghostLook();
      }
      ghost.visible = dynamic;
      tipAt.set(positions[last * 3], positions[last * 3 + 1], positions[last * 3 + 2]);
      // Within a vertex of vertex 0 the tip's dot would land on the start dot, so it stands in for it there.
      start.visible = last > 1 && last < positions.length / 3 - 1;
      if (tip.first !== last) {
        tip.first = last;
        tip.update();
      }
      closeUp.update(dt, tipAt, start.visible);
      labels.update();
    },
  };
}
