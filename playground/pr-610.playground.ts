/**
 * PR #610: on WebKit's WebGPU, a batch within its pass's cap culls on the CPU and draws direct
 *
 * `?caps=direct` forces every batch onto that path, so desktop Chrome shows what an iPhone runs;
 * `?caps=indirect` forces the GPU cull and bundles; `auto` keeps the browser's own caps. D cycles
 * the mode live and Space pauses the motion, so toggling while paused compares the two paths'
 * pixels.
 *
 * The playground tab passes the scene only its renderer, so set `caps` on the frame itself:
 * `/scene-frame.html?type=playground&id=pr-610&renderer=webgpu&caps=direct`.
 */

import type { CullResults, ShadowData } from '@pixi/3d';
import {
  BatchedMesh3D,
  ConeGeometry,
  cpuSubmission,
  cpuSubmissionLimit,
  CubeGeometry,
  DirectionalLight,
  ForwardRenderPass,
  Material3D,
  Matrix4,
  Mesh3D,
  PlaneGeometry,
  RenderPassBit,
  SphereGeometry,
  View3D,
} from '@pixi/3d';
import { Application, RendererType } from 'pixi.js';

import { rendererPreference } from './src/getPreference';

const MODES = ['auto', 'direct', 'indirect'] as const;
const CAPS: Record<(typeof MODES)[number], number | undefined> = { auto: undefined, direct: Infinity, indirect: 0 };
const CASCADES = 3;

export default async function () {
  const app = new Application();

  await app.init({ resizeTo: window, preference: rendererPreference, backgroundColor: 0x1d1d22 });
  document.body.appendChild(app.canvas);

  const param = new URLSearchParams(location.search).get('caps');
  let mode = MODES.find((m) => m === param) ?? 'auto';
  const applyCaps = () => {
    const cap = CAPS[mode];
    // unused-internal-disable -- PR #610 verification reads the internal caps and cull results
    if (cap === undefined) {
      delete cpuSubmission.forward;
      delete cpuSubmission.shadow;
    } else {
      cpuSubmission.forward = cap;
      cpuSubmission.shadow = cap;
    }
    // unused-internal-enable
  };
  applyCaps();

  const view3d = new View3D({ autoResize: true });
  app.stage.addChild(view3d);

  const sun = new DirectionalLight({
    intensity: 6,
    castShadow: true,
    shadow: { cascades: CASCADES, maxDistance: 80 },
  });
  sun.rotation.set(-0.9, 0.6, 0);
  view3d.root.addChild(sun);

  const ground = new Mesh3D({
    geometry: new PlaneGeometry({ width: 140, height: 140 }),
    material: new Material3D({ baseColor: 0x3a3f4b, roughness: 0.9 }),
    castShadow: false,
  });
  ground.rotation.x = -Math.PI / 2;
  view3d.root.addChild(ground);

  const geometries = [
    new CubeGeometry(),
    new SphereGeometry({ radius: 0.6 }),
    new ConeGeometry({ radius: 0.6, height: 1.2 }),
  ];
  const materials = [
    new Material3D({ baseColor: 0xe07a4a, roughness: 0.5 }),
    new Material3D({ baseColor: 0x6ec7c4, roughness: 0.4 }),
  ];
  const glass = new Material3D({ baseColor: 0xf2c14e, alpha: 0.5, alphaMode: 'blend' });

  // A 20 x 20 grid wider than the orbit, so the frustum cull always drops some of it
  const grid = 20;
  const meshes: Mesh3D[] = [];
  for (let i = 0; i < grid * grid; i++) {
    const mesh = new Mesh3D({
      geometry: geometries[i % geometries.length],
      material: i % 10 === 0 ? glass : materials[Math.floor(i / 3) % materials.length],
      castShadow: true,
    });
    mesh.position.set(((i % grid) - grid / 2 + 0.5) * 4, 0.6, (Math.floor(i / grid) - grid / 2 + 0.5) * 4);
    meshes.push(view3d.root.addChild(mesh));
  }

  const ringSize = 300;
  const ring = new BatchedMesh3D({ size: ringSize, cull: 'gpu' });
  const matrix = new Matrix4();
  for (let i = 0; i < ringSize; i++) {
    const angle = (i / ringSize) * Math.PI * 2;
    ring.setGeometryAt(i, geometries[i % 2]);
    ring.setMaterialAt(i, materials[i % 2]);
    ring.setMatrixAt(
      i,
      matrix.makeTranslation(Math.cos(angle) * 50, 4 + Math.sin(angle * 6) * 2, Math.sin(angle) * 50),
    );
  }
  view3d.root.addChild(ring);

  const camera = view3d.camera;
  camera.far = 300;

  const overlay = document.createElement('pre');
  overlay.style.cssText =
    'position:fixed;top:8px;left:8px;margin:0;padding:8px;font:12px monospace;color:#e6e6e6;' +
    'background:rgba(0,0,0,0.65);pointer-events:none';
  document.body.appendChild(overlay);

  let paused = false;
  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyD') {
      mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      applyCaps();
    } else if (event.code === 'Space') {
      paused = !paused;
    }
  });

  const webGpu = app.renderer.type === RendererType.WEBGPU;
  const forwardPasses = [
    ['opaque', RenderPassBit.OPAQUE],
    ['transparent', RenderPassBit.TRANSPARENT],
  ] as const;
  const drawsLabel = (direct: boolean | undefined) => {
    if (direct === undefined) return '-';

    return direct ? 'direct' : 'indirect';
  };

  let t = 0;
  let flipClock = 0;
  let flipOffset = 0;
  let overlayClock = Infinity;

  app.ticker.add((ticker) => {
    if (!paused) {
      t += ticker.deltaMS * 0.0001;
      flipClock += ticker.deltaMS;
    }
    camera.position.set(Math.cos(t) * 45, 18, Math.sin(t) * 45);
    camera.lookAt({ x: 0, y: 0, z: 0 });

    // Hiding and showing meshes moves the batches' visibility, which both the CPU cull and the
    // GPU kernel read, so the direct draws' counts change between frames as well as with the camera
    if (flipClock >= 500) {
      flipClock = 0;
      flipOffset++;
      for (let i = 0; i < meshes.length; i++) meshes[i].visible = (i + flipOffset) % 7 !== 0;
      for (let i = 0; i < ringSize; i += 5) ring.setVisibleAt(i, (i + flipOffset) % 3 !== 0);
    }

    overlayClock += ticker.deltaMS;
    if (overlayClock < 250) return;
    overlayClock = 0;

    // unused-internal-disable -- PR #610 verification reads the internal caps and cull results
    const lines = [
      `PR #610 CPU submission    D: cycle caps    Space: ${paused ? 'resume' : 'pause'}`,
      `caps: ${mode} (?caps=auto|direct|indirect)`,
      `resolved: forward ${cpuSubmissionLimit('forward')}, shadow ${cpuSubmissionLimit('shadow')}`,
    ];
    if (!webGpu) {
      lines.push('WebGL: this PR changes nothing here');
      overlay.textContent = lines.join('\n');

      return;
    }

    lines.push('', 'batch    cull  pass         instances  draws');
    const shadowData: (ShadowData & { cullResults?: CullResults }) | null = sun._gpuShadowData;
    const shadowResults = shadowData?.cullResults;
    for (const batch of view3d._meshBatches) {
      const name = (batch === view3d._sceneBatch ? 'scene' : 'batched').padEnd(9);
      const cull = batch.cull.padEnd(6);
      for (const [label, bit] of forwardPasses) {
        const list = batch.drawLists[bit];
        if (!list) continue;
        const pass = view3d.passByBit[bit];
        const result = pass instanceof ForwardRenderPass ? pass.cullResults.get(batch) : undefined;
        lines.push(
          `${name}${cull}${label.padEnd(13)}${String(list.view.count).padEnd(11)}${drawsLabel(result?.direct)}`,
        );
      }
      const shadowList = batch.drawLists[RenderPassBit.SHADOW];
      if (!shadowList || !shadowResults) continue;
      const cascades: string[] = [];
      for (let c = 0; c < CASCADES; c++) cascades.push(drawsLabel(shadowResults.get(batch, c)?.direct));
      lines.push(
        `${name}${cull}${'shadow'.padEnd(13)}${String(shadowList.view.count).padEnd(11)}${cascades.join(' ')}`,
      );
    }
    overlay.textContent = lines.join('\n');
    // unused-internal-enable
  });
}
