import type { Pass3D } from '@pixi/3d';
import {
  CubeGeometry,
  DirectionalLight,
  Material3D,
  Mesh3D,
  PlaneGeometry,
  SphereGeometry,
  TorusKnotGeometry,
  View3D,
} from '@pixi/3d';
import { ExtractPass, MotionBlurEffect, normalOutput, OrbitCamera, SsaoEffect, VelocityViewer } from '@pixi/3d/extras';
import { Application, Sprite, Text } from 'pixi.js';

import { rendererPreference } from './src/getPreference';

/**
 * PR #669: scene outputs, extra textures the scene draw writes beside its colour
 *
 * The camera orbits a knot, spheres and pillars. Each key toggles one pass that reads an output;
 * the view writes an output only while an enabled pass requires it.
 *
 * - V: `VelocityViewer`, the velocity output as colour
 * - B: `MotionBlurEffect`, which blurs along the velocity
 * - S: `SsaoEffect` with `sceneNormals`, which reads the normal output
 * - N: an `ExtractPass` copy of the normal output, shown under the label
 *
 * What to look for:
 *
 * - The glass ball above the knot writes its own normal, matching its depth: with S on, its
 *   occlusion looks like an opaque ball's. With V on it reads the motion of whatever is behind it,
 *   zero over the sky.
 * - The small cube fixed to the camera doesn't move on screen, yet it streaks with B or V on: the
 *   velocity comes from the camera's motion alone.
 *
 * Drag to turn the camera by hand. Compare `renderer=webgpu` with `renderer=webgl`.
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

  const ssao = new SsaoEffect({ radius: 0.6, intensity: 1.6, sceneNormals: true, resolution: 1 });
  const motionBlur = new MotionBlurEffect({ intensity: 4, enabled: false });
  const viewer = new VelocityViewer({ scale: 0.3, enabled: false });
  const extract = new ExtractPass({ output: normalOutput });

  const view3d = new View3D({
    autoResize: true,
    environment: { skyColor: 0xdfe8f2, groundColor: 0x30281f },
    passes: [ssao, motionBlur, viewer, extract],
  });
  app.stage.addChild(view3d);
  view3d.camera.fov = 45;
  view3d.camera.position.set(0, 3, 10);

  new OrbitCamera({
    view: view3d,
    target: { x: 0, y: 0.8, z: 0 },
    enableDamping: true,
    autoRotate: true,
    autoRotateSpeed: 6,
  });

  const sun = new DirectionalLight({ intensity: 2.5 });
  sun.position.set(5, 8, 4);
  sun.lookAt({ x: 0, y: 0, z: 0 });

  const floor = new Mesh3D({
    geometry: new PlaneGeometry({ width: 20, height: 20 }),
    material: new Material3D({ baseColor: 0x6b5d4f, roughness: 0.9 }),
  });
  floor.rotation.x = -Math.PI / 2;

  const knot = new Mesh3D({
    geometry: new TorusKnotGeometry({ radius: 0.7, tube: 0.22, tubularSegments: 160, radialSegments: 16 }),
    material: new Material3D({ baseColor: 0x2b6cb0, roughness: 0.3 }),
  });
  knot.position.y = 1.3;

  const glass = new Mesh3D({
    geometry: new SphereGeometry({ radius: 0.6 }),
    material: new Material3D({ transmission: { factor: 1 } }),
  });
  glass.position.y = 3;
  view3d.root.addChild(sun, floor, knot, glass);

  const attached = new Mesh3D({
    geometry: new CubeGeometry({ width: 0.2, height: 0.2, depth: 0.2 }),
    material: new Material3D({ baseColor: 0xf2b134 }),
  });
  attached.position.set(0.5, -0.5, -2.5);
  view3d.camera.addChild(attached);

  const ball = new SphereGeometry({ radius: 0.6 });
  const pillar = new CubeGeometry({ width: 0.8, height: 3, depth: 0.8 });
  const ballMaterial = new Material3D({ baseColor: 0xe0533d, roughness: 0.4 });
  const pillarMaterial = new Material3D({ baseColor: 0xd8d2c4, roughness: 0.7 });
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const sphere = new Mesh3D({ geometry: ball, material: ballMaterial });
    const post = new Mesh3D({ geometry: pillar, material: pillarMaterial });
    sphere.position.set(Math.cos(angle) * 3, 0.6, Math.sin(angle) * 3);
    post.position.set(Math.cos(angle + 0.8) * 6, 1.5, Math.sin(angle + 0.8) * 6);
    view3d.root.addChild(sphere, post);
  }

  const label = new Text({ style: { fill: 0xffffff, fontSize: 14, fontFamily: 'monospace' } });
  const thumbnail = new Sprite(extract.texture);
  label.position.set(12, 12);
  thumbnail.position.set(12, 100);
  thumbnail.scale.set(0.25);
  app.stage.addChild(thumbnail, label);

  const toggles: [key: string, name: string, pass: Pass3D][] = [
    ['v', 'VelocityViewer', viewer],
    ['b', 'MotionBlurEffect', motionBlur],
    ['s', 'SsaoEffect, sceneNormals', ssao],
    ['n', 'ExtractPass, normal output', extract],
  ];
  const refresh = () => {
    thumbnail.visible = extract.enabled;
    label.text = toggles
      .map(([key, name, pass]) => `${key.toUpperCase()}  ${pass.enabled ? 'on ' : 'off'}  ${name}`)
      .join('\n');
  };
  refresh();

  window.addEventListener('keydown', (event) => {
    const toggle = toggles.find(([key]) => key === event.key.toLowerCase());
    if (!toggle) return;
    toggle[2].enabled = !toggle[2].enabled;
    refresh();
  });
}
