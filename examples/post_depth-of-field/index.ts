/**
 * Depth of field: `DepthOfFieldEffect` keeps one camera depth sharp and blurs what's nearer or farther, as a lens does
 *
 * The effect reads the scene's depth and gives every pixel a blur radius from its distance to `focusDistance`: none
 * within `focusRange`, growing over `focusFalloff` to `maxBlur`. The sharp zone is a plane facing the camera, so the
 * floor at the shape's depth stays sharp with it. Sharp edges stay sharp against the blur behind them, and a blurred
 * shape in front spreads over what's behind it. `quality` picks 48 taps a pixel or 16; `'auto'` takes 16 on a phone.
 * `debug` paints the zones instead of blurring.
 *
 * Controls: tap a shape to focus on it; drag to orbit; the pane picks the focus, sets a manual distance, shapes the
 * sharp zone and the blur, picks the quality and shows the zones. URL flags: `?theme=light|dark`, `?renderer=webgl|webgpu`.
 */

import { Mesh3D, Vector3, View3D } from '@pixi/3d';
import { DepthOfFieldEffect, OrbitCamera } from '@pixi/3d/extras';
import type { DepthOfFieldEffectOptions } from '@pixi/3d/extras';
import { Application } from 'pixi.js';

import { rendererPreference } from '../../playground/src/getPreference';
import { clayMaterial } from '../shared/theme/clay';
import { fitPortrait } from '../shared/theme/fitPortrait';
import { LoadingScreen } from '../shared/theme/LoadingScreen';
import { THEMES, themeFromUrl } from '../shared/theme/palette';
import { clayGeometry } from '../shared/theme/shapes';
import { ThemePane } from '../shared/theme/ThemePane';
import { ThemeStage } from '../shared/theme/ThemeStage';

/** Fits the three shapes across a portrait screen without changing their relative depths */
const FIT_ASPECT = 0.9;
/** The blur at full strength, in CSS pixels: enough to soften a shape without losing it */
const MAX_BLUR = 16;
/** The most blur the pane allows, in CSS pixels */
const BLUR_RANGE = 32;
/** The focus list's value for focusing at the manual distance instead of on a shape */
const MANUAL = -1;

const theme = themeFromUrl();
const loading = new LoadingScreen({ theme, label: 'Depth of field' });
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

// maxBlur counts physical pixels, so it's scaled to look the same on a 2× screen. The default quality is 'auto'.
let depthOfField = new DepthOfFieldEffect({
  focusRange: 0.65,
  focusFalloff: 0.65,
  maxBlur: MAX_BLUR * app.renderer.resolution,
});
const view3d = new View3D({ autoResize: true, passes: [depthOfField] });
const stage = new ThemeStage(view3d, { theme, fog: { near: 22, far: 48 } });

// A shadow pass would cost a draw per shape and teach nothing here.
stage.key.castShadow = false;
app.stage.addChild(view3d);

// Three shapes at three depths, so whichever one is in focus, the other two blur.
const shapes = [
  new Mesh3D({ geometry: clayGeometry('cube'), material: clayMaterial('pink'), position: { x: -2, y: 1, z: 3 } }),
  new Mesh3D({ geometry: clayGeometry('torus'), material: clayMaterial('sky'), position: { x: 0, y: 1, z: 0 } }),
  new Mesh3D({
    geometry: clayGeometry('octahedron'),
    material: clayMaterial('orange'),
    position: { x: 2.4, y: 1, z: -3 },
  }),
];

for (const shape of shapes) {
  shape.scale.set(1.6, 1.6, 1.6);
  shape.eventMode = 'static';
  shape.cursor = 'pointer';
  view3d.root.addChild(shape);
}

view3d.camera.fov = 40;
view3d.camera.position.set(0, 4, 13);

// Kept above the floor, whose checker shows the sharp band.
const orbit = new OrbitCamera({
  view: view3d,
  target: { x: 0, y: 1, z: 0 },
  enableDamping: true,
  enablePan: false,
  maxPolarAngle: Math.PI * 0.45,
});

fitPortrait({ renderer: app.renderer, orbit, stage, minAspect: FIT_ASPECT });

const settings = {
  focusOn: 1,
  manualDistance: 13,
  quality: 'auto' as NonNullable<DepthOfFieldEffectOptions['quality']>,
};
const pane = new ThemePane({ title: 'Depth of field', stage });
const focusRow = pane.addBinding(settings, 'focusOn', {
  label: 'Focus on',
  options: { 'Near cube': 0, 'Middle torus': 1, 'Far crystal': 2, 'Manual distance': MANUAL },
});
const manualRow = pane.addBinding(settings, 'manualDistance', { label: 'Manual distance', min: 1, max: 40, step: 0.1 });

// Picking 'Manual distance' keeps the plane where it is, so the slider starts from the depth in focus.
focusRow.on('change', () => {
  if (settings.focusOn !== MANUAL) return;
  settings.manualDistance = depthOfField.focusDistance;
  manualRow.refresh();
});
manualRow.on('change', () => {
  settings.focusOn = MANUAL;
  focusRow.refresh();
});

let folder = addEffectRows();

/** The effect's own rows, bound to whichever effect is in the view */
function addEffectRows(): ReturnType<typeof pane.addFolder> {
  const rows = pane.addFolder({ title: 'DepthOfFieldEffect' });

  rows
    .addBinding(settings, 'quality', { options: { auto: 'auto', high: 'high', low: 'low' } })
    .on('change', () => replaceEffect());
  rows.addBinding(depthOfField, 'focusDistance', { readonly: true, interval: 300, format: (v) => v.toFixed(1) });
  rows.addBinding(depthOfField, 'focusRange', { min: 0, max: 3, step: 0.05 });
  rows.addBinding(depthOfField, 'focusFalloff', { min: 0.1, max: 6, step: 0.05 });
  rows.addBinding(depthOfField, 'maxBlur', { min: 0, max: BLUR_RANGE * app.renderer.resolution, step: 1 });
  rows.addBinding(depthOfField, 'debug');

  return rows;
}

/**
 * Swaps in an effect at the picked quality with the same settings: quality is fixed at construction, and replacing
 * `passes` rebuilds the view's render graph once, which is fine for a pane row
 */
function replaceEffect(): void {
  const { focusDistance, focusRange, focusFalloff, maxBlur, debug } = depthOfField;
  const next = new DepthOfFieldEffect({
    focusDistance,
    focusRange,
    focusFalloff,
    maxBlur,
    debug,
    quality: settings.quality,
  });

  view3d.passes = [next];
  depthOfField.destroy();
  depthOfField = next;
  folder.dispose();
  folder = addEffectRows();
}

shapes.forEach((shape, i) =>
  shape.on('pointertap', () => {
    settings.focusOn = i;
    focusRow.refresh();
  }),
);

const worldPoint = new Vector3();
const cameraPoint = new Vector3();

/** Puts the focus plane at the manual distance, or at the picked shape's depth in front of the camera */
function updateFocus(): void {
  if (settings.focusOn === MANUAL) {
    depthOfField.focusDistance = settings.manualDistance;
  } else {
    shapes[settings.focusOn].getGlobalPosition(worldPoint);
    // The camera looks down its -z, so depth is -z in camera space. The straight-line distance from the camera
    // would focus on a sphere round it rather than a plane.
    view3d.camera.toLocal(worldPoint, undefined, cameraPoint);
    depthOfField.focusDistance = -cameraPoint.z;
  }
}

let elapsed = 0;

app.ticker.add((ticker) => {
  const dt = Math.min(ticker.deltaMS / 1000, 1 / 15);

  elapsed += dt;
  stage.update(dt);
  // A slow sway keeps the scene live. It turns each shape in place, so no shape's depth changes.
  for (let i = 0; i < shapes.length; i++) shapes[i].rotation.y = Math.sin(elapsed * 0.35 + i) * 0.3;
  // Orbiting changes every shape's depth, so the plane follows the picked shape each frame.
  updateFocus();
});

orbit.update();
updateFocus();
app.render();
document.body.appendChild(app.canvas);
await loading.finish();
app.start();
