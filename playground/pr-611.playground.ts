import type { CullMode } from '@pixi/3d';
import {
  BatchedMesh3D,
  ConeGeometry,
  cpuSubmission,
  CubeGeometry,
  DirectionalLight,
  Material3D,
  Matrix4,
  Mesh3D,
  PlaneGeometry,
  RenderPassBit,
  SphereGeometry,
  TorusGeometry,
  View3D,
} from '@pixi/3d';
import { GraphDebugOverlay, OrbitCamera } from '@pixi/3d/extras';
import { Application } from 'pixi.js';

import { rendererPreference } from './src/getPreference';

/**
 * PR #611: an `'off'` batch drawn direct records its direct draws into a bundle
 *
 * The caps start at `Infinity`, so every browser draws direct: Safari does under its own caps,
 * Chrome only through this override. Watch the bundle status in the graph overlay, for the scene
 * batch and the `BatchedMesh3D`, in the opaque and shadow passes:
 *
 * - Steady frames: bundle reused.
 * - H (hide or show a mesh) or B (hide or show a batched slot): bundle recorded, counts changed.
 * - S (hide one mesh, show one in the same command): bundle reused, and the cube on screen moves.
 * - C (the view's cull to `'cpu'` or `'gpu'`): no bundle for the scene batch, which draws direct
 *   every frame. The `BatchedMesh3D` keeps its own `'off'`.
 * - D: caps at `0`, the indirect path, for comparison. The frame should look the same.
 * - P: blinks a mesh every frame, which re-records the bundle every frame, for timing.
 */
export default async function () {
  const app = new Application();

  await app.init({ resizeTo: window, preference: rendererPreference, backgroundColor: 0x1d1d22 });
  document.body.appendChild(app.canvas);

  const setCaps = (cap: number) => {
    // unused-internal-disable -- no public API forces direct draws off WebKit; this scene compares them
    cpuSubmission.forward = cap;
    cpuSubmission.shadow = cap;
    // unused-internal-enable
  };
  let direct = true;

  setCaps(Infinity);

  const view3d = new View3D({ autoResize: true, cull: 'off' });

  app.stage.addChild(view3d);
  view3d.camera.position.set(0, 14, 22);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  new OrbitCamera({ view: view3d, enableDamping: true });

  const sun = new DirectionalLight({ intensity: 4, castShadow: true });

  sun.rotation.set(-Math.PI / 3, Math.PI / 5, 0);
  view3d.root.addChild(sun);

  const ground = new Mesh3D({
    geometry: new PlaneGeometry({ width: 40, height: 40 }),
    material: new Material3D({ baseColor: 0x808080 }),
    castShadow: false,
  });

  ground.rotation.set(-Math.PI / 2, 0, 0);
  view3d.root.addChild(ground);

  const geometries = [
    new CubeGeometry({ width: 0.8, height: 0.8, depth: 0.8 }),
    new SphereGeometry({ radius: 0.45 }),
    new ConeGeometry({ radius: 0.4, height: 0.9 }),
    new TorusGeometry({ radius: 0.3, tube: 0.12 }),
  ];
  const materials = [new Material3D({ baseColor: 0xe06040 }), new Material3D({ baseColor: 0x40a0e0 })];
  const meshes: Mesh3D[] = [];

  for (let i = 0; i < 400; i++) {
    const mesh = new Mesh3D({ geometry: geometries[i % 4], material: materials[Math.floor(i / 4) % 2] });

    mesh.position.set((i % 20) - 9.5, 0.5, Math.floor(i / 20) - 9.5);
    meshes.push(view3d.root.addChild(mesh));
  }
  // Meshes 0 and 8 share a geometry and a material, so they draw in one command
  meshes[8].visible = false;

  const batched = new BatchedMesh3D({ size: 20 });
  const matrix = new Matrix4();

  for (let i = 0; i < 20; i++) {
    batched.setGeometryAt(i, geometries[0]);
    batched.setMaterialAt(i, materials[1]);
    batched.setMatrixAt(i, matrix.makeTranslation(i - 9.5, 0.5, 11));
    batched.setPassesAt(i, RenderPassBit.OPAQUE | RenderPassBit.SHADOW);
  }
  view3d.root.addChild(batched);

  new GraphDebugOverlay({ view: () => view3d, renderer: app.renderer });

  const cullModes: CullMode[] = ['off', 'cpu', 'gpu'];
  let blink = false;
  const actions: Record<string, () => void> = {
    h: () => {
      meshes[1].visible = !meshes[1].visible;
    },
    s: () => {
      const shown = meshes[0].visible;

      meshes[0].visible = !shown;
      meshes[8].visible = shown;
    },
    b: () => batched.setVisibleAt(0, !batched.getVisibleAt(0)),
    c: () => {
      view3d.cull = cullModes[(cullModes.indexOf(view3d.cull) + 1) % cullModes.length];
    },
    d: () => {
      direct = !direct;
      setCaps(direct ? Infinity : 0);
    },
    p: () => {
      blink = !blink;
    },
  };

  const hud = document.createElement('pre');

  hud.style.cssText = 'position:fixed;left:8px;bottom:8px;margin:0;color:#ddd;font:12px monospace;pointer-events:none';
  document.body.appendChild(hud);

  const updateHud = () => {
    hud.textContent = `${direct ? 'direct' : 'indirect'} draws · view cull '${view3d.cull}' · blink ${blink ? 'on' : 'off'}
H hide/show · S swap in one command · B batched slot · C cull · D direct/indirect · P blink`;
  };

  updateHud();
  window.addEventListener('keydown', (event) => {
    const action = actions[event.key.toLowerCase()];

    if (!action) return;
    action();
    updateHud();
  });

  app.ticker.add(() => {
    if (blink) meshes[2].visible = !meshes[2].visible;
  });
}
