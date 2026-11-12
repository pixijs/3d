import { getApp } from '@test-utils';
import type { Application, WebGLRenderer, WebGPURenderer } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';

import type { Mesh3DData } from '~/core/batcher/Mesh3DData';
import { MAX_LIGHTS } from '~/core/lightLimits';
import type { ForwardRenderPass } from '~/core/render-passes/ForwardRenderPass';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { PointLight } from '~/scene/lights/PointLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const RENDERERS = ['webgl', 'webgpu'] as const;

const SAMPLER_MARK = { webgl: 'sampleShadowLayer', webgpu: 'textureSampleCompareLevel' } as const;

function fragmentSource(mesh: Mesh3DData): string {
  const shader = mesh._passCache[RenderPassBit.OPAQUE].shader;
  const fragment: unknown = shader.gpuProgram ? shader.gpuProgram.fragment?.source : shader.glProgram.fragment;

  return fragment as string;
}

for (const preference of RENDERERS) {
  // oxlint-disable-next-line vitest/valid-title -- parametrising over both renderers by name
  describe(preference, () => {
    let app: Application<WebGLRenderer | WebGPURenderer> | undefined;

    afterEach(() => {
      app?.destroy();
      app = undefined;
    });

    it('compiles the shadow sampler in on the first caster and never takes it back out', async () => {
      app = await getApp({ id: `shadow-sampling-${preference}`, appOptions: { preference } });

      const view = new View3D({ width: 64, height: 64 });
      const sun = new DirectionalLight({ intensity: 3 });
      const receiver = new Mesh3D({ geometry: new SphereGeometry({ radius: 1 }), material: new Material3D() });
      const optedOut = new Mesh3D({
        geometry: new SphereGeometry({ radius: 1 }),
        material: new Material3D(),
        receiveShadow: false,
      });

      sun.position.set(5, 8, 5);
      sun.lookAt({ x: 0, y: 0, z: 0 });
      view.root.addChild(sun, receiver, optedOut);
      app.stage.addChild(view);

      const mark = SAMPLER_MARK[preference];

      app.render();
      expect(view._hasShadows).toBe(false);
      expect(fragmentSource(receiver), 'with nothing casting, even a receiver draws with the stub').not.toContain(mark);

      sun.castShadow = true;
      app.render();
      expect(view._hasShadows).toBe(true);
      expect(fragmentSource(receiver), 'the first caster turns sampling on, the same frame').toContain(mark);
      expect(fragmentSource(optedOut), 'for meshes that receive only').not.toContain(mark);

      sun.castShadow = false;
      app.render();
      expect(view._hasShadows).toBe(true);
      expect(fragmentSource(receiver), 'losing the caster does not recompile back to the stub').toContain(mark);
    });

    it('updates batched receiver variants and cached draw work when a hidden caster appears', async () => {
      app = await getApp({ id: `batched-shadow-sampling-${preference}`, appOptions: { preference } });

      const view = new View3D({ width: 64, height: 64 });
      const sun = new DirectionalLight({ intensity: 3, castShadow: true, visible: false });
      const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
      const material = new Material3D();
      const matrix = new Matrix4();
      const batch = new BatchedMesh3D({ size: 2 });

      for (let i = 0; i < batch.size; i++) {
        batch.setGeometryAt(i, geometry);
        batch.setMaterialAt(i, material);
        batch.setMatrixAt(i, matrix);
        batch.setPassesAt(i, RenderPassBit.OPAQUE | RenderPassBit.SHADOW);
      }

      const receiver = batch.batch.items[0];
      const optedOut = batch.batch.items[1];

      optedOut.receiveShadow = false;
      sun.position.set(5, 8, 5);
      sun.lookAt({ x: 0, y: 0, z: 0 });
      view.root.addChild(sun, batch);
      app.stage.addChild(view);

      const mark = SAMPLER_MARK[preference];

      app.render();
      expect(view._hasShadows).toBe(false);
      expect(fragmentSource(receiver)).not.toContain(mark);

      const drawList = batch.batch.drawLists[RenderPassBit.OPAQUE];
      const commandDirtyId = drawList.commandList.dirtyId;
      const rangesDirtyId = drawList.rangesDirtyId;
      const bundleDirtyId = drawList.gpuData.bundleDirtyId;
      const pass = view.passByBit[RenderPassBit.OPAQUE] as ForwardRenderPass;
      const originalBundle = pass.cullResults.get(batch.batch)?.bundle ?? null;

      sun.visible = true;
      app.render();

      expect(view._hasShadows).toBe(true);
      expect(fragmentSource(receiver)).toContain(mark);
      expect(fragmentSource(optedOut)).not.toContain(mark);
      expect(
        drawList.commandList.dirtyId !== commandDirtyId || drawList.rangesDirtyId !== rangesDirtyId,
        'the cached draw work changed, rebuilt or edited',
      ).toBe(true);

      const nextBundle = pass.cullResults.get(batch.batch)?.bundle ?? null;

      expect(originalBundle !== null).toBe(preference === 'webgpu');
      expect(
        drawList.gpuData.bundleDirtyId,
        'binding the shadow map into the global group invalidates every bundle',
      ).toBeGreaterThan(bundleDirtyId);
      expect(
        originalBundle !== null && nextBundle !== null && nextBundle !== originalBundle,
        'so the bundle re-records, whether the list rebuilt or was edited',
      ).toBe(preference === 'webgpu');

      const shadowShader = receiver._passCache[RenderPassBit.OPAQUE].shader;

      sun.castShadow = false;
      app.render();

      expect(receiver._passCache[RenderPassBit.OPAQUE].shader).toBe(shadowShader);
      expect(fragmentSource(receiver)).toContain(mark);
    });

    it('enables sampling only when a caster enters the packed light limit', async () => {
      app = await getApp({ id: `shadow-sampling-light-cap-${preference}`, appOptions: { preference } });

      const view = new View3D({ width: 64, height: 64 });
      const hidden = new PointLight({ visible: false });
      const points = Array.from({ length: MAX_LIGHTS }, (_, i) => {
        const light = new PointLight({ intensity: 0 });

        light.position.set(i + 1, 2, 0);

        return light;
      });
      const sun = new DirectionalLight({ intensity: 3, castShadow: true });
      const receiver = new Mesh3D({ geometry: new SphereGeometry({ radius: 1 }), material: new Material3D() });

      sun.position.set(5, 8, 5);
      sun.lookAt({ x: 0, y: 0, z: 0 });
      view.root.addChild(new AmbientLight(), hidden, ...points, sun, receiver);
      app.stage.addChild(view);

      const mark = SAMPLER_MARK[preference];

      app.render();
      expect(view._hasShadows).toBe(false);
      expect(sun._shadowDataIndex).toBe(-1);
      expect(fragmentSource(receiver)).not.toContain(mark);

      points[0].visible = false;
      app.render();

      expect(view._hasShadows).toBe(true);
      expect(sun._shadowDataIndex).toBeGreaterThanOrEqual(0);
      expect(fragmentSource(receiver)).toContain(mark);
    });
  });
}
