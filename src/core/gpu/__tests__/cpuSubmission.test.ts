import { getApp, renderFrame } from '@test-utils';
import type { Renderer, WebGPURenderer } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cpuSubmission } from '~/core/cull';
import type { CullResults } from '~/core/render-passes/CullResults';
import type { ForwardRenderPass } from '~/core/render-passes/ForwardRenderPass';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { CylinderGeometry } from '~/geometry/CylinderGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { SpotLight } from '~/scene/lights/SpotLight';
import { Mesh3D } from '~/scene/Mesh3D';
import type { CullMode } from '~/scene/View3D';
import { View3D } from '~/scene/View3D';

const SIZE = 64;

async function sceneWithAnEmptyCommand(id: string, cull: CullMode = 'gpu', blend = false, shadow = false) {
  const app = await getApp<Renderer>({
    id,
    appOptions: { preference: 'webgpu', width: SIZE, height: SIZE },
  });
  const view3d = new View3D({ width: SIZE, height: SIZE, cull });
  view3d.camera.position.set(0, 0, 30);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  app.stage.addChild(view3d);
  const material = new Material3D({ alphaMode: blend ? 'blend' : 'opaque' });
  const cube = new CubeGeometry();
  const ball = new SphereGeometry({ radius: 1 });
  const meshes: Mesh3D[] = [];
  for (let i = 0; i < 12; i++) {
    const mesh = new Mesh3D({ geometry: i % 2 ? ball : cube, material, castShadow: shadow });
    mesh.position.set(i - 6, 0, 0);
    mesh.visible = i % 2 === 0;
    meshes.push(view3d.root.addChild(mesh));
  }
  let spot: SpotLight | null = null;
  if (shadow) {
    spot = new SpotLight({ range: 60, coneAngle: 40, castShadow: true });
    spot.position.set(0, 0, 20);
    view3d.root.addChild(spot);
    spot.lookAt({ x: 0, y: 0, z: 0 });
  }
  app.render();
  const encoder = (app.renderer as WebGPURenderer).encoder;
  const spies = {
    draw: vi.spyOn(encoder, 'draw'),
    drawIndirect: vi.spyOn(encoder, 'drawIndirect'),
    executeBundle: vi.spyOn(encoder, 'executeBundle'),
    beginBundle: vi.spyOn(encoder, 'beginBundle'),
  };
  app.render();
  const batch = view3d._sceneBatch;
  const bit = blend ? RenderPassBit.TRANSPARENT : RenderPassBit.OPAQUE;
  const pass = view3d.passByBit[bit] as ForwardRenderPass;
  const result = pass.cullResults.get(batch)!;
  const list = batch.drawLists[bit];
  const args = result.indirectDrawData.drawCalls;
  const counts = Array.from({ length: list.commandList.count }, (_, k) => args[k * 5 + 1]);
  const shadowResult = spot ? (spot._gpuShadowData as { cullResults?: CullResults }).cullResults?.get(batch) : null;
  return { app, view3d, batch, material, meshes, result, shadowResult, counts, spies };
}

const directDraws = (spies: { draw: ReturnType<typeof vi.spyOn> }) =>
  spies.draw.mock.calls.filter(([options]: [{ firstInstance?: number }]) => options.firstInstance !== undefined);

const recordings = (spies: { beginBundle: ReturnType<typeof vi.spyOn> }, label: string) =>
  spies.beginBundle.mock.calls.filter(([name]: [string]) => name.startsWith(label));

async function renderParityScene(id: string, cap: number) {
  cpuSubmission.forward = cap;
  cpuSubmission.shadow = cap;
  const app = await getApp<Renderer>({
    id,
    appOptions: { preference: 'webgpu', width: 96, height: 96, backgroundColor: 0x203040 },
  });
  const view3d = new View3D({ width: 96, height: 96, shadowQuality: 'low' });
  app.stage.addChild(view3d);
  view3d.camera.position.set(4, 6, 10);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

  const materials = [0xc0392b, 0x27ae60, 0x2980b9, 0x888888].map(
    (baseColor) => new Material3D({ baseColor, metallic: 0, roughness: 0.6 }),
  );
  const glass = new Material3D({ baseColor: 0xf1c40f, alphaMode: 'blend', alpha: 0.5 });
  const geometries = [
    new CubeGeometry({ width: 0.8, height: 0.8, depth: 0.8 }),
    new SphereGeometry({ radius: 0.45 }),
    new CylinderGeometry({ radiusTop: 0.3, radiusBottom: 0.4, height: 0.9 }),
  ];

  const ground = new Mesh3D({
    geometry: new PlaneGeometry({ width: 12, height: 12 }),
    material: materials[3],
    castShadow: false,
  });
  ground.position.set(0, -0.5, 0);
  ground.rotation.set(-Math.PI / 2, 0, 0);
  view3d.root.addChild(ground);
  for (let g = 0; g < geometries.length; g++) {
    for (let i = 0; i < 4; i++) {
      const mesh = new Mesh3D({ geometry: geometries[g], material: materials[g], castShadow: true });
      mesh.position.set(i * 1.5 - 2.25, 0, g * 1.5 - 1.5);
      view3d.root.addChild(mesh);
    }
  }
  const offScreen = new Mesh3D({ geometry: geometries[0], material: materials[0], castShadow: true });
  offScreen.position.set(60, 0, 0);
  view3d.root.addChild(offScreen);
  const hidden = new Mesh3D({ geometry: geometries[1], material: materials[1], castShadow: true });
  hidden.position.set(0, 1.2, 0);
  hidden.visible = false;
  view3d.root.addChild(hidden);
  const blended = new Mesh3D({ geometry: geometries[1], material: glass, castShadow: false });
  blended.position.set(0.75, 1, 2);
  view3d.root.addChild(blended);

  const sun = new DirectionalLight({ color: 0xfff4e0, intensity: 4, castShadow: true });
  sun.rotation.set((-55 * Math.PI) / 180, (55 * Math.PI) / 180, 0);
  view3d.root.addChild(sun);

  try {
    app.render();
    app.render();
    const encoder = (app.renderer as WebGPURenderer).encoder;
    const spies = {
      draw: vi.spyOn(encoder, 'draw'),
      drawIndirect: vi.spyOn(encoder, 'drawIndirect'),
      executeBundle: vi.spyOn(encoder, 'executeBundle'),
    };
    const pixels = await renderFrame(app);

    const batch = view3d._sceneBatch;
    const passResult = (bit: number) => (view3d.passByBit[bit] as ForwardRenderPass).cullResults.get(batch);
    const shadowResults = (sun._gpuShadowData as { cullResults?: CullResults } | null)?.cullResults;
    const direct = {
      opaque: passResult(RenderPassBit.OPAQUE)?.direct,
      transparent: passResult(RenderPassBit.TRANSPARENT)?.direct,
      shadow: shadowResults?.get(batch, 0)?.direct,
    };
    const drew = {
      direct: directDraws(spies).length,
      indirect: spies.drawIndirect.mock.calls.length,
      bundles: spies.executeBundle.mock.calls.length,
    };

    return { pixels, direct, drew };
  } finally {
    for (const material of [...materials, glass]) material.destroy();
    app.destroy();
  }
}

describe('CPU submission on WebGPU', () => {
  afterEach(() => {
    delete cpuSubmission.forward;
    delete cpuSubmission.shadow;
  });

  it('within the cap: culls on the CPU, replays its direct draws from a bundle, and re-records when a count changes', async () => {
    cpuSubmission.forward = Infinity;
    const { app, material, result, counts, spies } = await sceneWithAnEmptyCommand('cpu-submission-on');
    try {
      expect(result.direct).toBe(true);
      expect(result.bundle, 'the direct draws were recorded').not.toBeNull();
      expect(recordings(spies, 'view3d pass'), 'an unchanged walk keeps the bundle').toHaveLength(0);
      expect(spies.drawIndirect, 'no indirect draw').not.toHaveBeenCalled();
      expect(spies.executeBundle, 'the bundle replays').toHaveBeenCalled();
      expect(counts, 'one command holds the six visible cubes, the other is empty').toEqual(
        expect.arrayContaining([6, 0]),
      );

      const bundle = result.bundle;
      result.countsDirtyId++;
      app.render();
      expect(result.bundle, 'a changed count re-records').not.toBe(bundle);
      expect(recordings(spies, 'view3d pass')).toHaveLength(1);
      expect(directDraws(spies), 'one direct draw per non-empty command').toHaveLength(
        counts.filter((c) => c > 0).length,
      );
    } finally {
      material.destroy();
      app.destroy();
    }
  });

  it("an 'off' batch within the cap: walks visibility on the CPU, records its direct draws into a bundle, and re-records only after a flip", async () => {
    cpuSubmission.forward = Infinity;
    const { app, batch, material, meshes, result, counts, spies } = await sceneWithAnEmptyCommand(
      'cpu-submission-off-within',
      'off',
    );
    try {
      expect(result.direct, 'the pass draws the batch direct').toBe(true);
      expect(result.bundle, 'the direct draws were recorded').not.toBeNull();
      expect(spies.drawIndirect).not.toHaveBeenCalled();
      expect(spies.executeBundle).toHaveBeenCalled();
      expect(counts, 'the hidden spheres left their command').toEqual(expect.arrayContaining([6, 0]));

      const bundle = result.bundle;
      spies.draw.mockClear();
      spies.beginBundle.mockClear();
      const walked = vi.spyOn(result.survivors, 'upload');
      const uploadedArgs = vi.spyOn(result.indirectDrawData.drawCallsBuffer, 'update');
      app.render();
      expect(walked, 'no flip, no walk').not.toHaveBeenCalled();
      expect(result.lastVisibilityDirtyId).toBe(batch._visibilityDirtyId);
      expect(result.bundle, 'no flip, the same bundle').toBe(bundle);
      expect(recordings(spies, 'view3d pass'), 'and no re-record').toHaveLength(0);
      expect(directDraws(spies), 'the bundle replays the draws').toHaveLength(0);

      meshes[0].visible = false;
      app.render();
      expect(walked, 'a flip walks once').toHaveBeenCalledTimes(1);
      expect(result.indirectDrawData.drawCalls[1] + result.indirectDrawData.drawCalls[6], 'five cubes left').toBe(5);
      expect(recordings(spies, 'view3d pass'), 'a flip re-records once').toHaveLength(1);
      expect(result.bundle).not.toBe(bundle);
      expect(directDraws(spies), 'the new bundle holds one direct draw per non-empty command').toHaveLength(1);
      expect(spies.drawIndirect).not.toHaveBeenCalled();
      expect(uploadedArgs, 'the args never leave the CPU on this path').not.toHaveBeenCalled();

      const flipped = result.bundle;
      meshes[0].visible = true;
      meshes[2].visible = false;
      app.render();
      expect(walked, 'a swap inside one command walks').toHaveBeenCalledTimes(2);
      expect(result.bundle, 'the same counts keep the bundle, which reads the survivors live').toBe(flipped);
      expect(recordings(spies, 'view3d pass'), 'so nothing re-records').toHaveLength(1);
    } finally {
      material.destroy();
      app.destroy();
    }
  });

  it("an 'off' batch within the cap: a swap inside one command keeps the bundle and draws the shown instance", async () => {
    cpuSubmission.forward = Infinity;
    const app = await getApp<Renderer>({
      id: 'cpu-submission-off-swap-pixels',
      appOptions: { preference: 'webgpu', width: SIZE, height: SIZE, backgroundColor: 0x000000 },
    });
    const view3d = new View3D({ width: SIZE, height: SIZE, cull: 'off' });
    view3d.camera.position.set(0, 0, 6);
    app.stage.addChild(view3d);
    const geometry = new CubeGeometry({ width: 2, height: 2, depth: 2 });
    const material = new FlatMaterial({ baseColor: 0xffffff });
    const left = view3d.root.addChild(new Mesh3D({ geometry, material }));
    const right = view3d.root.addChild(new Mesh3D({ geometry, material }));
    left.position.set(-1.5, 0, 0);
    right.position.set(1.5, 0, 0);
    right.visible = false;
    const leftCubeColumn = 18;
    const rightCubeColumn = 46;
    const brightnessInMiddleRow = (pixels: Uint8ClampedArray, x: number) => {
      const i = ((SIZE / 2) * SIZE + x) * 4;
      return Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
    };
    try {
      await renderFrame(app);
      let pixels = await renderFrame(app);
      const result = (view3d.passByBit[RenderPassBit.OPAQUE] as ForwardRenderPass).cullResults.get(view3d._sceneBatch)!;
      const bundle = result.bundle;
      expect(result.direct).toBe(true);
      expect(bundle).not.toBeNull();
      expect(brightnessInMiddleRow(pixels, leftCubeColumn), 'the left cube is drawn').toBeGreaterThan(200);
      expect(brightnessInMiddleRow(pixels, rightCubeColumn), 'the right cube is hidden').toBeLessThan(8);

      left.visible = false;
      right.visible = true;
      pixels = await renderFrame(app);
      expect(result.bundle, 'one instance either way, so the bundle is kept').toBe(bundle);
      expect(
        brightnessInMiddleRow(pixels, leftCubeColumn),
        'the kept bundle no longer draws the left cube',
      ).toBeLessThan(8);
      expect(brightnessInMiddleRow(pixels, rightCubeColumn), 'it reads the new survivor when it runs').toBeGreaterThan(
        200,
      );
    } finally {
      material.destroy();
      app.destroy();
    }
  });

  it("an 'off' batch within the cap: a rebuilt list re-records its direct-draw bundle", async () => {
    cpuSubmission.forward = Infinity;
    const { app, batch, material, result, spies } = await sceneWithAnEmptyCommand(
      'cpu-submission-off-within-rebuild',
      'off',
    );
    try {
      const bundle = result.bundle;
      expect(bundle).not.toBeNull();
      spies.beginBundle.mockClear();

      batch.invalidateDrawCaches();
      app.render();
      expect(recordings(spies, 'view3d pass'), 'the rebuild re-synced the result and re-recorded').toHaveLength(1);
      expect(result.bundle).not.toBe(bundle);

      const rebuilt = result.bundle;
      batch.invalidateBundleCaches();
      app.render();
      expect(recordings(spies, 'view3d pass'), 'a stale bundle re-records too').toHaveLength(2);
      expect(result.bundle).not.toBe(rebuilt);
    } finally {
      material.destroy();
      app.destroy();
    }
  });

  it("an 'off' batch that leaves the cap: drops its direct-draw bundle and walks again to feed indirect draws", async () => {
    cpuSubmission.forward = Infinity;
    const { app, material, result, spies } = await sceneWithAnEmptyCommand('cpu-submission-off-leaves-cap', 'off');
    try {
      const directBundle = result.bundle;
      expect(directBundle).not.toBeNull();
      const uploadedArgs = vi.spyOn(result.indirectDrawData.drawCallsBuffer, 'update');

      cpuSubmission.forward = 11;
      app.render();
      expect(result.direct).toBe(false);
      expect(result.bundle, 'an indirect bundle took its place').not.toBe(directBundle);
      expect(result.bundle).not.toBeNull();
      expect(uploadedArgs, 'the visibility compaction ran and uploaded its counts').toHaveBeenCalled();
      expect(spies.drawIndirect, 'the new bundle draws indirect').toHaveBeenCalled();
    } finally {
      material.destroy();
      app.destroy();
    }
  });

  it("a 'cpu' batch over the cap: culls on the CPU, uploads the args, and keeps indirect draws in a bundle", async () => {
    cpuSubmission.forward = 0;
    const { app, material, meshes, result, spies } = await sceneWithAnEmptyCommand('cpu-submission-cpu-over', 'cpu');
    try {
      expect(result.direct, 'a cap of 0 keeps the batch indirect').toBe(false);
      expect(result.bundle).not.toBeNull();
      expect(spies.executeBundle).toHaveBeenCalled();
      const bundle = result.bundle;
      const version = result.countsDirtyId;
      spies.beginBundle.mockClear();
      const uploadedArgs = vi.spyOn(result.indirectDrawData.drawCallsBuffer, 'update');
      meshes[0].visible = false;
      app.render();
      expect(uploadedArgs, 'the frustum walk feeds the indirect draws every frame').toHaveBeenCalled();
      expect(result.countsDirtyId, 'the walk changed a count').not.toBe(version);
      expect(result.bundle, 'an indirect bundle reads the counts on the GPU, so it is kept').toBe(bundle);
      expect(recordings(spies, 'view3d pass'), 'and not re-recorded').toHaveLength(0);
    } finally {
      material.destroy();
      app.destroy();
    }
  });

  it("a back-to-front pass within the cap: an 'off' batch draws direct from the CPU visibility walk", async () => {
    cpuSubmission.forward = Infinity;
    const { app, material, result, counts, spies } = await sceneWithAnEmptyCommand(
      'cpu-submission-off-sorted',
      'off',
      true,
    );
    try {
      expect(result.direct, 'the pass draws the batch direct').toBe(true);
      expect(result.bundle).toBeNull();
      expect(spies.drawIndirect, 'the sorted pass stopped replaying indirect').not.toHaveBeenCalled();
      expect(
        counts.reduce((a, b) => a + b, 0),
        'the six visible cubes, however the sort split them',
      ).toBe(6);
      expect(directDraws(spies), 'one direct draw per non-empty command').toHaveLength(
        counts.filter((c) => c > 0).length,
      );
    } finally {
      material.destroy();
      app.destroy();
    }
  });

  it("a shadow cascade within its cap: an 'off' batch records its casters' direct draws into a bundle and reuses it", async () => {
    cpuSubmission.forward = Infinity;
    cpuSubmission.shadow = Infinity;
    const { app, material, meshes, shadowResult, spies } = await sceneWithAnEmptyCommand(
      'cpu-submission-off-shadow',
      'off',
      false,
      true,
    );
    try {
      expect(shadowResult, 'the spot culled the batch for its cascade').toBeTruthy();
      expect(shadowResult!.direct, 'the cascade draws the batch direct').toBe(true);
      expect(shadowResult!.bundle, 'the cascade recorded its direct draws').not.toBeNull();
      expect(spies.drawIndirect).not.toHaveBeenCalled();

      const bundle = shadowResult!.bundle;
      spies.beginBundle.mockClear();
      app.render();
      expect(shadowResult!.bundle, 'no flip, the same bundle').toBe(bundle);
      expect(recordings(spies, 'shadow cascade'), 'and no re-record').toHaveLength(0);

      meshes[0].visible = false;
      app.render();
      expect(recordings(spies, 'shadow cascade'), 'a flip re-records the cascade').toHaveLength(1);
      expect(shadowResult!.bundle).not.toBe(bundle);
      expect(spies.drawIndirect).not.toHaveBeenCalled();
    } finally {
      material.destroy();
      app.destroy();
    }
  });

  it("a shadow cascade over its cap: a 'cpu' batch keeps its indirect bundle when the walk changes the counts", async () => {
    cpuSubmission.forward = 0;
    cpuSubmission.shadow = 0;
    const { app, material, meshes, shadowResult, spies } = await sceneWithAnEmptyCommand(
      'cpu-submission-cpu-shadow-over',
      'cpu',
      false,
      true,
    );
    try {
      expect(shadowResult!.direct).toBe(false);
      const bundle = shadowResult!.bundle;
      expect(bundle).not.toBeNull();
      const version = shadowResult!.countsDirtyId;
      spies.beginBundle.mockClear();

      meshes[0].visible = false;
      app.render();
      expect(shadowResult!.countsDirtyId, 'the walk changed a count').not.toBe(version);
      expect(shadowResult!.bundle, 'the indirect bundle is kept').toBe(bundle);
      expect(recordings(spies, 'shadow cascade'), 'and not re-recorded').toHaveLength(0);
    } finally {
      material.destroy();
      app.destroy();
    }
  });

  it('at the cap: still submits from the CPU', async () => {
    cpuSubmission.forward = 12;
    const { app, material, result, spies } = await sceneWithAnEmptyCommand('cpu-submission-at-cap');
    try {
      expect(result.direct, 'twelve instances fit a cap of twelve').toBe(true);
      expect(spies.drawIndirect, 'no indirect draw').not.toHaveBeenCalled();
    } finally {
      material.destroy();
      app.destroy();
    }
  });

  it('direct draws render the same frame as indirect ones, shadows and the back-to-front pass included', async () => {
    const indirect = await renderParityScene('cpu-submission-parity-indirect', 0);
    const direct = await renderParityScene('cpu-submission-parity-direct', Infinity);

    expect(indirect.direct, 'a cap of 0 keeps every pass indirect').toEqual({
      opaque: false,
      transparent: false,
      shadow: false,
    });
    expect(indirect.drew.bundles, 'the opaque pass replays its bundle').toBeGreaterThan(0);
    expect(direct.direct, 'no cap puts every pass on direct draws').toEqual({
      opaque: true,
      transparent: true,
      shadow: true,
    });
    expect(direct.drew.indirect, 'nothing drew indirect').toBe(0);
    expect(direct.drew.bundles, 'the opaque pass and the shadow replay their direct-draw bundles').toBeGreaterThan(0);
    expect(direct.drew.direct, 'the back-to-front pass draws the blended sphere direct').toBeGreaterThanOrEqual(1);

    const a = indirect.pixels;
    const b = direct.pixels;
    let lit = 0;
    let differing = 0;
    for (let p = 0; p < a.length; p += 4) {
      if (a[p] !== a[0] || a[p + 1] !== a[1] || a[p + 2] !== a[2]) lit++;
      if (a[p] !== b[p] || a[p + 1] !== b[p + 1] || a[p + 2] !== b[p + 2] || a[p + 3] !== b[p + 3]) differing++;
    }
    expect(lit, 'the scene covers part of the frame').toBeGreaterThan(500);
    expect(differing, 'pixels that differ between the two paths').toBe(0);
  });
});
