/**
 * What the frame draws to explain the queries: every triangle's edges, with the few each query tests filled in; the
 * downward ray and its hit on the terrain; the rock's nearest point with a line to the ball's centre; and, when the
 * pane asks, the boxes each query's walk entered
 *
 * It reads the queries' results each frame and never changes the scene, so `index.ts` runs the same without it.
 */

import { Box, Vector3 } from '@pixi/3d';
import type { Mesh3D, Ray, View3D } from '@pixi/3d';
import type { Application } from 'pixi.js';

import { ArrowHelper } from '../shared/theme/ArrowHelper';
import { BoxHelper } from '../shared/theme/BoxHelper';
import { DotHelper } from '../shared/theme/DotHelper';
import { LabelLayer } from '../shared/theme/LabelLayer';
import type { ThemeStage } from '../shared/theme/ThemeStage';
import { TriangleHelper } from '../shared/theme/TriangleHelper';
import { WireframeHelper } from '../shared/theme/WireframeHelper';

/**
 * The most boxes drawn for each mesh: the ball's sphere enters up to about 60 of the rock's boxes at the largest
 * radius, the ray about 20 of the terrain's
 */
const MAX_BOXES = 72;
/**
 * The most tested triangles filled in for each mesh: the ball's sphere reaches up to about 50 of the rock's at the
 * largest radius, the ray about 8 of the terrain's
 */
const MAX_TRIANGLES = 96;
/** A box's edge width, in world units, thin so the nested boxes stay apart */
const BOX_THICKNESS = 0.012;
/** A triangle edge's width, in world units, thin so the dense terrain still reads */
const EDGE_THICKNESS = 0.005;

/** What a walk entered, copied out of `traverse`, in the mesh's local space */
export interface Visited {
  readonly boxes: readonly Box[];
  boxCount: number;
  /** The first triangles it tested, up to the array's length */
  readonly triangles: Uint32Array;
  /** Every triangle it tested, including those past the array's length */
  triangleCount: number;
}

export function createVisited(): Visited {
  return {
    boxes: Array.from({ length: MAX_BOXES }, () => new Box()),
    boxCount: 0,
    triangles: new Uint32Array(MAX_TRIANGLES),
    triangleCount: 0,
  };
}

export interface VisualsOptions {
  app: Application;
  view3d: View3D;
  stage: ThemeStage;
  terrain: Mesh3D;
  rock: Mesh3D;
  ball: Mesh3D;
  /** The downward ray, in world space */
  down: Ray;
  /** What the queries found, in world space */
  found: { readonly ground: Vector3; readonly onGround: boolean; readonly nearest: Vector3 };
  visited: { readonly terrain: Visited; readonly rock: Visited };
  params: { readonly showTriangles: boolean };
}

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();

export function createVisuals({
  app,
  view3d,
  stage,
  terrain,
  rock,
  ball,
  down,
  found,
  visited,
  params,
}: VisualsOptions): { update(): void } {
  const labels = new LabelLayer({ view3d, stage });
  // Each mesh's helpers are its children, so they read its geometry in its local space and turn and scale with it.
  const terrainNet = meshNet(terrain);
  const rockNet = meshNet(rock);
  // X-ray, so the ray shows through the ball to the ground it hits.
  const ray = new ArrowHelper({ thickness: 0.025, xray: true, parent: view3d.root });
  const ground = new DotHelper({ color: 'accent', outline: true, parent: view3d.root });
  const nearest = new DotHelper({ color: 'accent', outline: true, parent: view3d.root });
  const toCentre = new ArrowHelper({ color: 'ink', thickness: 0.015, head: false, xray: true, parent: view3d.root });
  const terrainBoxes = boxPool(terrain);
  const rockBoxes = boxPool(rock);
  const rayTag = labels.add({ text: 'raycast', at: down.origin, offset: { x: 0, y: -14 } });

  labels.add({ text: 'closest point', node: nearest, offset: { x: 0, y: -22 } });
  app.stage.addChild(labels);

  /** Every edge of the mesh, faint, and a pool of filled triangles for the ones a query tests */
  function meshNet(mesh: Mesh3D): { edges: WireframeHelper; tested: TriangleHelper[] } {
    // Divided by the mesh's scale, so the edges are as wide on the rock as on the terrain.
    const thickness = EDGE_THICKNESS / mesh.scale.x;

    return {
      edges: new WireframeHelper({ geometry: mesh.geometry, thickness, muted: true, parent: mesh }),
      // X-ray, so the triangles under the ball show through it.
      tested: Array.from(
        { length: MAX_TRIANGLES },
        () => new TriangleHelper({ opacity: 0.75, xray: true, visible: false, parent: mesh }),
      ),
    };
  }

  function boxPool(mesh: Mesh3D): BoxHelper[] {
    const thickness = BOX_THICKNESS / mesh.scale.x;

    return Array.from(
      { length: MAX_BOXES },
      () => new BoxHelper({ thickness, color: 'ink', opacity: 0.5, xray: true, visible: false, parent: mesh }),
    );
  }

  /** Reads a vertex's position, numbered as the triangle list numbers it */
  function vertex(mesh: Mesh3D, index: number, out: Vector3): Vector3 {
    const positions = mesh.geometry.positions;
    const i = mesh.geometry.indices[index] * 3;

    return out.set(positions[i], positions[i + 1], positions[i + 2]);
  }

  function showNet(mesh: Mesh3D, net: { edges: WireframeHelper; tested: TriangleHelper[] }, walk: Visited): void {
    const shown = params.showTriangles ? Math.min(walk.triangleCount, MAX_TRIANGLES) : 0;

    net.edges.visible = params.showTriangles;
    for (let i = 0; i < MAX_TRIANGLES; i++) {
      net.tested[i].visible = i < shown;
      if (i >= shown) continue;
      const first = walk.triangles[i] * 3;

      net.tested[i].set(vertex(mesh, first, _a), vertex(mesh, first + 1, _b), vertex(mesh, first + 2, _c));
    }
  }

  function showBoxes(pool: BoxHelper[], { boxes, boxCount }: Visited): void {
    for (let i = 0; i < MAX_BOXES; i++) {
      pool[i].visible = i < boxCount;
      if (i < boxCount) pool[i].setBox(boxes[i]);
    }
  }

  return {
    update() {
      ray.visible = ground.visible = found.onGround;
      if (found.onGround) {
        ray.set(down.origin, found.ground);
        ground.position.copyFrom(found.ground);
      }
      rayTag.at.copyFrom(down.origin);
      nearest.position.copyFrom(found.nearest);
      toCentre.set(found.nearest, ball.position);
      showNet(terrain, terrainNet, visited.terrain);
      showNet(rock, rockNet, visited.rock);
      showBoxes(terrainBoxes, visited.terrain);
      showBoxes(rockBoxes, visited.rock);
      labels.update();
    },
  };
}
