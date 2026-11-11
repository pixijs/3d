import { getApp, renderFrame } from '@test-utils';
import type { Application, Renderer } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';

import type { SceneOutput } from '~/core/render-graph/SceneOutput';
import { captureGraphDebugSnapshot } from '~/extras/debug/GraphDebugSnapshot';
import { SsaoEffect } from '~/extras/post-processing/effects/SsaoEffect';
import { normalOutput } from '~/extras/scene-outputs/normalOutput';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Pass3D } from '~/post-processing/Pass3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

class RequiresPass extends Pass3D {
  public readonly stage = 'afterTransparent';

  constructor(public override readonly requiredOutputs: readonly SceneOutput[]) {
    super();
  }

  public build(): void {}
}

const worldNormalOutput: SceneOutput = { name: 'normal', format: 'rgba16float' };

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`SsaoEffect normal source (${preference})`, () => {
    let app: Application<Renderer>;
    let view3d: View3D;

    async function occlusionSamples(id: string, passes: Pass3D[]): Promise<number[]> {
      app = await getApp<Renderer>({
        id: `ssao-normals-${id}-${preference}`,
        appOptions: { preference, width: 32, height: 32, autoStart: false },
      });
      view3d = new View3D({ width: 32, height: 32, passes });
      app.stage.addChild(view3d);
      view3d.camera.position.set(0, 0, 5);
      view3d.root.addChild(
        new Mesh3D({ geometry: new PlaneGeometry({ width: 40, height: 40 }), material: new Material3D() }),
      );

      await renderFrame(app);
      const compute = captureGraphDebugSnapshot(view3d._graph).passes.find((pass) => pass.name === 'ssao:compute');
      expect(compute, 'the effect built its occlusion pass').toBeDefined();
      return compute!.accesses.filter((access) => access.mode === 'sample').map((access) => access.handleId);
    }

    afterEach(() => {
      view3d?.destroy(true);
      app?.destroy();
    });

    it('rebuilds the normal from depth when the view writes no normals', async () => {
      expect(await occlusionSamples('alone', [new SsaoEffect()])).toEqual([view3d._graph.sceneDepth._id]);
      expect(view3d._graph.sceneOutputs).toEqual([]);
    });

    it('reads the normals another pass makes the view write, at no extra cost', async () => {
      const ssao = new SsaoEffect();
      expect(ssao.requiredOutputs).toBeUndefined();
      const samples = await occlusionSamples('shared', [ssao, new RequiresPass([normalOutput])]);
      expect(samples).toContain(view3d._graph.getSceneOutput(normalOutput)._id);
    });

    it('makes the view write the normals with sceneNormals, and reads them', async () => {
      const ssao = new SsaoEffect({ sceneNormals: true });
      expect(ssao.requiredOutputs).toEqual([normalOutput]);
      expect(await occlusionSamples('own', [ssao])).toContain(view3d._graph.getSceneOutput(normalOutput)._id);
    });

    it("ignores an app's own output that shares the name", async () => {
      const samples = await occlusionSamples('other', [new SsaoEffect(), new RequiresPass([worldNormalOutput])]);
      expect(samples).toEqual([view3d._graph.sceneDepth._id]);
    });
  });
}
