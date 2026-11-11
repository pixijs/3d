import { createDefaultGraph3D, CubeGeometry, Material3D, Mesh3D, PlaneGeometry, PointLight, View3D } from '@pixi/3d';
import { FxaaEffect, TiltShiftEffect } from '@pixi/3d/extras';
import { Application } from 'pixi.js';

import { rendererPreference } from './src/getPreference';

/**
 * PR #699: `View3D.resolution` draws the scene at its own resolution
 *
 * A floor lit by point lights and a glass cube, through tilt-shift then FXAA, so tilt-shift isn't
 * the last effect. The buttons step `view.resolution` the way a dynamic resolution loop would.
 *
 * What to look for at every step:
 *
 * - The rebuild count stays put. A view with post effects composites anyway, so a step only takes
 *   different textures from the pool.
 * - The blur on the two white posts, one in front of the focus and one behind it, stays the same
 *   width on screen. A blur that jumps wider at each step means tilt-shift is measuring in scene
 *   texels.
 * - The pools of light keep their shape, with no straight cuts through them, and the floor seen
 *   through the glass doesn't jump between steps.
 *
 * Compare `renderer=webgpu` with `renderer=webgl`.
 */
export default async function () {
  const app = new Application();

  await app.init({
    resizeTo: window,
    preference: rendererPreference,
    resolution: window.devicePixelRatio,
    autoDensity: true,
    backgroundColor: 0x10141a,
  });
  document.body.appendChild(app.canvas);

  let builds = 0;
  const view3d = new View3D({
    autoResize: true,
    environment: { skyColor: 0x39424e, groundColor: 0x15181c },
    passes: [new TiltShiftEffect({ focalDepth: 8.5, focalNear: 1.5, focalFar: 6, maxBlur: 16 }), new FxaaEffect()],
    graph: (renderer, options) => {
      builds++;
      return createDefaultGraph3D(renderer, options).graph;
    },
  });
  app.stage.addChild(view3d);
  view3d.camera.fov = 45;
  view3d.camera.position.set(0, 4, 8);
  view3d.camera.lookAt({ x: 0, y: 0.5, z: 0 });

  const floor = new Mesh3D({
    geometry: new PlaneGeometry({ width: 40, height: 40 }),
    material: new Material3D({ baseColor: 0x8a8f96, roughness: 0.7 }),
  });
  floor.rotation.x = -Math.PI / 2;
  view3d.root.addChild(floor);

  [0xff5a4d, 0xffc53d, 0x7be36a, 0x3dd6ff, 0x6f7cff, 0xd96bff].forEach((color, i) => {
    const light = new PointLight({ color, intensity: 30, range: 6 });
    light.position.set(i % 2 ? 3 : -3, 1, 4 - i * 3);
    view3d.root.addChild(light);
  });

  const glass = new Mesh3D({
    geometry: new CubeGeometry({ width: 1.6, height: 1.6, depth: 1.6 }),
    material: new Material3D({ metallic: 0, roughness: 0.05, transmission: { factor: 1, thickness: 0.5 }, ior: 1.5 }),
  });
  glass.position.set(0, 1.2, 0);
  view3d.root.addChild(glass);

  for (const [x, z] of [
    [1.6, 5],
    [-2, -6],
  ]) {
    const post = new Mesh3D({
      geometry: new CubeGeometry({ width: 0.6, height: 1.2, depth: 0.6 }),
      material: new Material3D({ baseColor: 0x000000, emissive: { color: 0xffffff, strength: 1 } }),
    });
    post.position.set(x, 0.6, z);
    view3d.root.addChild(post);
  }

  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;top:12px;left:12px;color:#fff;font:14px monospace';
  const label = document.createElement('div');
  label.style.marginBottom = '6px';
  panel.append(label);
  document.body.appendChild(panel);

  const ratios = [0.85, 0.67, 0.5];
  for (const resolution of ['inherit', ...ratios.map((ratio) => app.renderer.resolution * ratio)] as const) {
    const button = document.createElement('button');
    button.textContent = resolution === 'inherit' ? resolution : resolution.toFixed(2);
    button.style.marginRight = '6px';
    button.onclick = () => (view3d.resolution = resolution);
    panel.append(button);
  }

  app.ticker.add((ticker) => {
    glass.rotation.y += ticker.deltaMS * 0.0004;
    const resolution = view3d.resolution === 'inherit' ? app.renderer.resolution : view3d.resolution;
    const size = `${Math.round(app.screen.width * resolution)} x ${Math.round(app.screen.height * resolution)}`;
    label.textContent = `resolution ${view3d.resolution}, scene ${size} texels, rebuilds ${Math.max(0, builds - 1)}`;
  });
}
