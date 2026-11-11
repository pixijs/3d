/**
 * The shared theme kit in one scene: the loading screen, the light and dark checker stage with its fog, clay
 * shapes in the palette's colours, the 3D logo and the 2D wordmark
 *
 * Start a themed example from this file; `examples/shared/theme/README.md` covers each piece.
 *
 * Controls: drag to orbit; the pane switches themes. URL flags: `?theme=light|dark`, `?renderer=webgl|webgpu`.
 */

import { Mesh3D, View3D } from '@pixi/3d';
import { OrbitCamera } from '@pixi/3d/extras';
import { Application, Graphics } from 'pixi.js';

import { rendererPreference } from '../playground/src/getPreference';
import { clayMaterial } from './shared/theme/clay';
import { fitPortrait } from './shared/theme/fitPortrait';
import { LoadingScreen } from './shared/theme/LoadingScreen';
import { loadPixiLogo } from './shared/theme/logo';
import { BRAND, CLAY_COLORS, THEMES, themeFromUrl } from './shared/theme/palette';
import { CLAY_SHAPES, clayGeometry } from './shared/theme/shapes';
import { ThemePane } from './shared/theme/ThemePane';
import { ThemeStage } from './shared/theme/ThemeStage';
import { WORDMARK_SIZE, wordmarkContext } from './shared/theme/wordmark';

const MARGIN = 20;
/** The narrowest view, width over height, that shows the shapes' arc whole from the landscape distance */
const FIT_ASPECT = 1.6;

const theme = themeFromUrl();
// Up before the renderer, so the page is never blank.
const loading = new LoadingScreen({ theme, label: 'Theme kit' });
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
const stage = new ThemeStage(view3d, { theme, spotlight: true, fog: { near: 10, far: 30 } });
const logo = await loading.load(() => loadPixiLogo({ width: 4 }));

app.stage.addChild(view3d);
logo.root.position.y = 1.7;
view3d.root.addChild(logo.root);

// One of each clay shape in a shallow arc in front of the logo, each in the next clay colour.
const shapes = CLAY_SHAPES.map((shape, i) => {
  const offset = i - (CLAY_SHAPES.length - 1) / 2;
  const mesh = new Mesh3D({ geometry: clayGeometry(shape), material: clayMaterial(CLAY_COLORS[i]) });

  mesh.position.set(offset * 1.5, 0.7, 1.8 - offset * offset * 0.12);
  view3d.root.addChild(mesh);

  return mesh;
});

view3d.camera.fov = 40;
view3d.camera.position.set(0, 3.2, 10);

const orbit = new OrbitCamera({
  view: view3d,
  target: { x: 0, y: 1.2, z: 0 },
  enableDamping: true,
  enablePan: false,
  minDistance: 6,
  maxDistance: 16,
  // Stays above the floor.
  maxPolarAngle: Math.PI * 0.45,
});

// A portrait screen is narrower than the shapes' arc, so the camera and the fog back off until it fits.
fitPortrait({ renderer: app.renderer, orbit, stage, minAspect: FIT_ASPECT });

// The 2D wordmark as a corner badge, and the pane that switches themes.
const badge = new Graphics(wordmarkContext());

badge.tint = BRAND.pink;
badge.scale.set(28 / WORDMARK_SIZE.height);
badge.position.set(MARGIN, MARGIN);
app.stage.addChild(badge);
new ThemePane({ title: 'Theme kit', stage });

let time = 0;

app.ticker.add((ticker) => {
  const dt = Math.min(ticker.deltaMS / 1000, 1 / 15);

  time += dt;
  stage.update(dt);
  for (let i = 0; i < shapes.length; i++) {
    shapes[i].position.y = 0.7 + Math.sin(time * 1.6 + i) * 0.15;
    shapes[i].rotation.y = time * 0.5 + i;
  }
  logo.root.rotation.y = Math.sin(time * 0.4) * 0.25;
});

// The canvas joins with its first frame already drawn, then the loading screen dissolves onto it.
orbit.update();
app.render();
document.body.appendChild(app.canvas);
await loading.finish();
app.start();
