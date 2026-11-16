/**
 * Querying a mesh's triangles from your own code with `geometry.bvh`
 *
 * `geometry.bvh` is a `TriangleBvh`, a tree of boxes round the geometry's triangles, so a query tests the few
 * triangles near it rather than all of them. Each frame a `raycast` straight down sets the ball's height on the
 * terrain, `closestPointToPoint` pushes it out of the rock, and `intersectsSphere` turns it pink while it touches.
 * The tree works in the geometry's own space, so each query first moves the ray or the point into the mesh's local
 * space through the inverse of its global transform, and moves the answer back to world space after.
 *
 * Controls: drag the ball over the terrain; drag anywhere else to orbit. The pane sets the ball's radius, shows every
 * triangle with the few the queries test filled in, and shows the boxes the queries enter. URL flags:
 * `?theme=light|dark`, `?renderer=webgl|webgpu`.
 */

import { Matrix4, Ray, Sphere, Vector3, View3D } from '@pixi/3d';
import type { Box, Mesh3D, TriangleBvh } from '@pixi/3d';
import { OrbitCamera } from '@pixi/3d/extras';
import { Application } from 'pixi.js';

import { rendererPreference } from '../../playground/src/getPreference';
import { clayMaterial } from '../shared/theme/clay';
import { fitPortrait } from '../shared/theme/fitPortrait';
import { LoadingScreen } from '../shared/theme/LoadingScreen';
import { THEMES, themeFromUrl } from '../shared/theme/palette';
import { ThemePane } from '../shared/theme/ThemePane';
import { ThemeStage } from '../shared/theme/ThemeStage';
import { createBall, createRock, createTerrain, dragBall, setBallRadius, TERRAIN_HEIGHT, TERRAIN_SIZE } from './scene';
import { createVisited, createVisuals } from './visuals';
import type { Visited } from './visuals';

/** The narrowest view, width over height, that shows the whole patch from the landscape distance */
const FIT_ASPECT = 1.1;
/** The height the downward ray starts from, above the highest hill and the biggest ball */
const RAY_TOP = 3.2;
/** How far the ball may move between pushes, as a share of its radius: well under 1, so it never jumps into the rock */
const STEP = 0.5;
/** Steps a frame at most; a faster drag finishes on the next frames */
const MAX_STEPS = 16;
/** Added to the ball's radius for the touch test, so a ball pushed to one radius off the rock still touches it */
const CONTACT_SKIN = 0.01;

const theme = themeFromUrl();
// Up before the renderer, so the page is never blank.
const loading = new LoadingScreen({ theme, label: 'Mesh queries' });
const app = new Application();

await app.init({
  preference: rendererPreference,
  resizeTo: window,
  background: THEMES[theme].haze,
  antialias: true,
  autoStart: false,
  resolution: Math.min(window.devicePixelRatio, 2),
  autoDensity: true,
});
loading.progress(0.2);

const view3d = new View3D({ autoResize: true });
const stage = new ThemeStage(view3d, { theme, fog: { near: 16, far: 44 } });

app.stage.addChild(view3d);

const params = { radius: 0.35, showTriangles: true, showBoxes: false };
const terrain = createTerrain(view3d.root);
const rock = createRock(view3d.root);
const ball = createBall(view3d.root);

// Built now, while loading: the first read of `geometry.bvh` would build it otherwise, and the first frame would wait.
const buildStart = performance.now();

terrain.geometry.buildBvh();
rock.geometry.buildBvh();

const stats = {
  triangles: (terrain.geometry.indices.length + rock.geometry.indices.length) / 3,
  buildTime: `${(performance.now() - buildStart).toFixed(1)} ms`,
  tested: 0,
};

/** The mesh's tree. Reading `bvh` is cheap: it returns the one built above, refitted after an edit to the arrays */
function treeOf(mesh: Mesh3D): TriangleBvh {
  const tree = mesh.geometry.bvh;

  if (!tree) throw new Error('Only a triangle list with Float32Array positions has a bvh');

  return tree;
}

// Each mesh's global transform takes its local space to the world, and the inverse takes the world to it. Neither
// mesh moves, so they're read once; a moving mesh would read them every frame.
const terrainToWorld = terrain.getGlobalTransform(new Matrix4());
const worldToTerrain = new Matrix4().getInverse(terrainToWorld);
const rockToWorld = rock.getGlobalTransform(new Matrix4());
const worldToRock = new Matrix4().getInverse(rockToWorld);

// Made once and refilled every frame, so the loop allocates nothing.
const down = new Ray(new Vector3(), new Vector3(0, -1, 0));
const localRay = new Ray();
const localPoint = new Vector3();
const touch = new Sphere();
const localSphere = new Sphere();
/** What the queries found, in world space, for the visuals */
const found = { ground: new Vector3(), onGround: false, distance: -1, nearest: new Vector3() };
const away = new Vector3();
const BALL_MATERIAL = clayMaterial('orange');
const TOUCHING_MATERIAL = clayMaterial('pink');

/** Casts straight down at the terrain and stands the ball on the hit */
function rideTerrain(): void {
  down.origin.set(ball.position.x, RAY_TOP, ball.position.z);
  down.applyMatrix4(worldToTerrain, localRay);
  // The distance is in the terrain's units, so the hit is found along the local ray and then moved to the world.
  const distance = treeOf(terrain).raycast(localRay);

  found.distance = distance;
  found.onGround = distance >= 0;
  if (!found.onGround) return;
  localRay.at(distance, found.ground).applyAffineMatrix4(terrainToWorld);
  ball.position.y = found.ground.y + params.radius;
}

/** Finds the rock's nearest point to the ball's centre and pushes the ball out to one radius from it */
function pushOutOfRock(): void {
  ball.position.applyAffineMatrix4(worldToRock, localPoint);
  treeOf(rock).closestPointToPoint(localPoint, found.nearest);
  found.nearest.applyAffineMatrix4(rockToWorld);
  // The distance it returns is in the rock's units, which its scale stretches, so the gap is measured in the world.
  const gap = ball.position.distanceTo(found.nearest);

  if (gap >= params.radius) return;
  away.copyFrom(ball.position).subtract(found.nearest).normalize();
  ball.position.copyFrom(found.nearest).addScaledVector(away, params.radius);
}

/** Whether any of the rock's triangles lies within the ball, plus a skin */
function touchesRock(): boolean {
  touch.set(ball.position, params.radius + CONTACT_SKIN);
  // A sphere keeps its shape under the rock's even scale, so it moves into the rock's space whole.
  return treeOf(rock).intersectsSphere(touch.applyMatrix4(worldToRock, localSphere));
}

// The reader's drag writes where they want the ball; the frame loop rolls it there.
const target = new Vector3().copyFrom(ball.position);

dragBall(view3d, ball, target);

/** Rolls the ball toward the target in short steps, pushing it out of the rock, then standing it on the terrain */
function moveBall(): void {
  const step = STEP * params.radius;
  const edge = TERRAIN_SIZE / 2 - params.radius;

  for (let i = 0; i < MAX_STEPS; i++) {
    const dx = Math.min(Math.max(target.x, -edge), edge) - ball.position.x;
    const dz = Math.min(Math.max(target.z, -edge), edge) - ball.position.z;
    const distance = Math.hypot(dx, dz);
    const share = distance > step ? step / distance : 1;

    ball.position.x += dx * share;
    ball.position.z += dz * share;
    pushOutOfRock();
    rideTerrain();
    if (share === 1) break;
  }
  ball.material = touchesRock() ? TOUCHING_MATERIAL : BALL_MATERIAL;
}

// `traverse` replays each query's walk: the boxes it enters and the triangles in them, which are all it tests.
const visited = { terrain: createVisited(), rock: createVisited() };

/** Copies `box` when the walk enters it, since `traverse` hands each callback one reused box */
function enter(list: Visited, box: Box, enters: boolean): boolean {
  if (enters && params.showBoxes && list.boxCount < list.boxes.length) list.boxes[list.boxCount++].copyFrom(box);

  return enters;
}

/** Counts every triangle the walk reaches and keeps the first ones for drawing */
function test(list: Visited, triangle: number): void {
  if (list.triangleCount < list.triangles.length) list.triangles[list.triangleCount] = triangle;
  list.triangleCount++;
}

// `raycast` enters the boxes the ray reaches before its hit; `intersectsSphere` those the sphere touches.
const rayEnters = (box: Box): boolean => {
  const t = localRay.intersectBoxT(box);

  return enter(visited.terrain, box, t >= 0 && (found.distance < 0 || t <= found.distance));
};
const sphereEnters = (box: Box): boolean => enter(visited.rock, box, localSphere.intersectsBox(box));
const testTerrain = (triangle: number): void => test(visited.terrain, triangle);
const testRock = (triangle: number): void => test(visited.rock, triangle);

function replayWalks(): void {
  visited.terrain.boxCount = visited.rock.boxCount = 0;
  visited.terrain.triangleCount = visited.rock.triangleCount = 0;
  treeOf(terrain).traverse(rayEnters, testTerrain);
  treeOf(rock).traverse(sphereEnters, testRock);
  stats.tested = visited.terrain.triangleCount + visited.rock.triangleCount;
}

setBallRadius(ball, params.radius);
moveBall();

replayWalks();

const visuals = createVisuals({ app, view3d, stage, terrain, rock, ball, down, found, visited, params });

view3d.camera.fov = 40;
view3d.camera.position.set(0.3, 5.4, 7.2);

const orbit = new OrbitCamera({
  view: view3d,
  target: { x: 0, y: TERRAIN_HEIGHT, z: 0 },
  enableDamping: true,
  enablePan: false,
  minDistance: 6,
  maxDistance: 16,
  // The clay draws front faces only, so the orbit stays above the sheet.
  maxPolarAngle: Math.PI * 0.4,
});

// A phone is narrower than the patch, so the camera and the fog back off until it fits.
fitPortrait({ renderer: app.renderer, orbit, stage, minAspect: FIT_ASPECT });

const pane = new ThemePane({ title: 'Mesh queries', stage });

pane.addBinding(params, 'radius', { label: 'Ball radius', min: 0.15, max: 0.6 });
pane.addBinding(params, 'showTriangles', { label: 'Triangles' });
pane.addBinding(params, 'showBoxes', { label: 'Visited boxes' });
pane.addBinding(stats, 'triangles', { label: 'Total', readonly: true, format: (n: number) => n.toFixed(0) });
pane.addBinding(stats, 'tested', { label: 'Tested', readonly: true, format: (n: number) => n.toFixed(0) });
pane.addBinding(stats, 'buildTime', { label: 'Build time', readonly: true });

app.ticker.add((ticker) => {
  const dt = Math.min(ticker.deltaMS / 1000, 1 / 15);

  stage.update(dt);
  setBallRadius(ball, params.radius);
  moveBall();
  replayWalks();
  visuals.update();
});

// The canvas joins with its first frame already drawn, then the loading screen dissolves onto it.
orbit.update();
visuals.update();
app.render();
document.body.appendChild(app.canvas);
await loading.finish();
app.start();
