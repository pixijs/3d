/**
 * Wide lines through points, with `RibbonGeometry`: a strip that turns to face the camera, its width in world units
 * or in pixels
 *
 * Two corkscrews run from the front of the floor to the back along the same points. The pink one's `width` is in
 * world units, so its far turns thin with distance like any object; the purple one's is in pixels, so it stays one
 * width on screen, like a 2D stroke. Each point can have its own width and colour. Orbit round them: the strip
 * always shows its face, because the vertex shader turns it every frame.
 *
 * Controls: drag to orbit; the pane sets each ribbon's width, tapers them, colours them point by point, and shows
 * the points. URL flags: `?theme=light|dark`, `?renderer=webgl|webgpu`.
 */

import { Mesh3D, RibbonGeometry, View3D } from '@pixi/3d';
import type { RibbonWidthUnits } from '@pixi/3d';
import { OrbitCamera } from '@pixi/3d/extras';
import { Application } from 'pixi.js';

import { rendererPreference } from '../../playground/src/getPreference';
import { createClayMaterial } from '../shared/theme/clay';
import { fitPortrait } from '../shared/theme/fitPortrait';
import { LoadingScreen } from '../shared/theme/LoadingScreen';
import { BRAND, THEMES, themeFromUrl } from '../shared/theme/palette';
import { ThemePane } from '../shared/theme/ThemePane';
import { ThemeStage } from '../shared/theme/ThemeStage';
import { corkscrewPoints, gradientColors, taperedWidths } from './scene';
import { createVisuals } from './visuals';

/** The narrowest view, width over height, that shows both corkscrews whole from the landscape distance */
const FIT_ASPECT = 1.2;
/** How far each corkscrew's axis sits from the middle */
const SPACING = 1.1;

const theme = themeFromUrl();
// Up before the renderer, so the page is never blank.
const loading = new LoadingScreen({ theme, label: 'Ribbons' });
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
const stage = new ThemeStage(view3d, { theme });

app.stage.addChild(view3d);

const params = { worldWidth: 0.14, pixelWidth: 7, taper: false, colors: true };

/** Everything that tells the two ribbons apart: where they run, their units, and their colours near and far */
const RIBBONS: Record<RibbonWidthUnits, { points: Float32Array; near: number; far: number; flat: number }> = {
  world: { points: corkscrewPoints(-SPACING), near: BRAND.pink, far: BRAND.orange, flat: BRAND.pink },
  pixels: { points: corkscrewPoints(SPACING), near: BRAND.purple, far: BRAND.sky, flat: BRAND.purple },
};

/**
 * A ribbon's geometry for the pane's settings. Widths and colours are vertex data, each point's copied to the two
 * vertices the shader pushes apart, so a change builds a new geometry.
 */
function buildRibbon(widthUnits: RibbonWidthUnits): RibbonGeometry {
  const { points, near, far, flat } = RIBBONS[widthUnits];
  const width = widthUnits === 'world' ? params.worldWidth : params.pixelWidth;

  return new RibbonGeometry({
    points,
    widthUnits,
    // One number for every point, or one per point.
    width: params.taper ? taperedWidths(width) : width,
    // One colour per point, red, green, blue and alpha; a flat colour is the same gradient end to end.
    colors: params.colors ? gradientColors(near, far) : gradientColors(flat, flat),
  });
}

// Any material draws a ribbon. A lit one shades the strip as a round cord, and `vertexColors` lets it read the
// geometry's `colors`.
const material = createClayMaterial({ color: 'white' });
material.vertexColors = true;

const worldRibbon = new Mesh3D({ geometry: buildRibbon('world'), material, parent: view3d.root });
// Shadows face their light, so the world ribbon casts one its own width. A pixel width means nothing to the
// light, whose shadow map has pixels of its own, so the purple ribbon casts none.
const pixelRibbon = new Mesh3D({ geometry: buildRibbon('pixels'), material, castShadow: false, parent: view3d.root });

/** Builds both ribbons again for the pane's settings, and frees the geometries they leave */
function rebuildRibbons(): void {
  for (const [mesh, units] of [
    [worldRibbon, 'world'],
    [pixelRibbon, 'pixels'],
  ] as const) {
    const old = mesh.geometry;
    mesh.geometry = buildRibbon(units);
    old.destroy(true);
  }
}

const visuals = createVisuals({
  app,
  view3d,
  stage,
  worldPoints: RIBBONS.world.points,
  pixelPoints: RIBBONS.pixels.points,
});

view3d.camera.fov = 40;
view3d.camera.position.set(1.6, 3.4, 8.5);

const orbit = new OrbitCamera({ view: view3d, target: { x: 0, y: 1.1, z: -1 }, enableDamping: true });

// A portrait screen is narrower than the pair, so the camera and the fog back off until both fit.
fitPortrait({ renderer: app.renderer, orbit, stage, minAspect: FIT_ASPECT });

const pane = new ThemePane({ title: 'Ribbons', stage });

pane
  .addBinding(params, 'worldWidth', { label: 'width (world)', min: 0.02, max: 0.4, step: 0.01 })
  .on('change', rebuildRibbons);
pane
  .addBinding(params, 'pixelWidth', { label: 'width (pixels)', min: 1, max: 24, step: 1 })
  .on('change', rebuildRibbons);
pane.addBinding(params, 'taper', { label: 'Taper' }).on('change', rebuildRibbons);
pane.addBinding(params, 'colors', { label: 'Colours' }).on('change', rebuildRibbons);
pane.addBinding(visuals, 'showPoints', { label: 'Points' });

app.ticker.add((ticker) => {
  const dt = Math.min(ticker.deltaMS / 1000, 1 / 15);

  stage.update(dt);
  visuals.update();
});

// The canvas joins with its first frame already drawn, then the loading screen dissolves onto it.
orbit.update();
visuals.update();
app.render();
document.body.appendChild(app.canvas);
await loading.finish();
app.start();
