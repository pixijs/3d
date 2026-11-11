import { getApp, renderFrame } from '@test-utils';
import type { Application, Renderer } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';

import type { SceneOutput } from '~/core/render-graph/SceneOutput';
import { ExtractPass } from '~/extras/scene-outputs/ExtractPass';
import { normalOutput } from '~/extras/scene-outputs/normalOutput';
import { velocityOutput } from '~/extras/scene-outputs/velocityOutput';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

describe('ExtractPass', () => {
  it('requires its output and copies into a texture of the same format', () => {
    const extract = new ExtractPass({ output: velocityOutput });

    expect(extract.requiredOutputs).toEqual([velocityOutput]);
    expect(extract.stage).toBe('afterTransparent');
    expect(extract.texture.source.format).toBe('rg16float');
    extract.destroy();
  });

  it('turns away an integer output, which the copy would sample as floats', () => {
    const objectIds: SceneOutput = { name: 'objectId', format: 'r32uint' };

    expect(() => new ExtractPass({ output: objectIds })).toThrow(/'objectId' is r32uint/);
  });

  it('destroys its texture with the pass', () => {
    const extract = new ExtractPass({ output: normalOutput });
    extract.destroy();

    expect(extract.texture.destroyed).toBe(true);
  });

  for (const preference of ['webgpu', 'webgl'] as const) {
    describe(`on ${preference}`, () => {
      let app: Application<Renderer>;
      let view3d: View3D;
      let extract: ExtractPass;

      afterEach(() => {
        view3d?.destroy(true);
        extract?.destroy();
        app?.destroy();
      });

      it("keeps the texture texel for texel with the scene at the view's logical size, and follows a resize", async () => {
        app = await getApp<Renderer>({
          id: `extract-pass-size-${preference}`,
          appOptions: { preference, width: 64, height: 64, resolution: 2, autoStart: false },
        });
        extract = new ExtractPass({ output: normalOutput });
        view3d = new View3D({ width: 24, height: 16, passes: [extract] });
        view3d.camera.position.set(0, 0, 5);
        view3d.root.addChild(
          new Mesh3D({ geometry: new PlaneGeometry({ width: 40, height: 40 }), material: new FlatMaterial() }),
        );
        app.stage.addChild(view3d);

        await renderFrame(app);
        const source = extract.texture.source;
        expect([source.pixelWidth, source.pixelHeight]).toEqual([48, 32]);
        expect([extract.texture.width, extract.texture.height, source.resolution]).toEqual([24, 16, 2]);

        view3d.width = 32;
        view3d.height = 20;
        await renderFrame(app);
        expect([source.pixelWidth, source.pixelHeight]).toEqual([64, 40]);

        view3d.resolution = 1;
        await renderFrame(app);
        expect([source.pixelWidth, source.pixelHeight], "the scene's texels at half resolution").toEqual([32, 20]);
        expect([extract.texture.width, extract.texture.height], "the view's logical size still").toEqual([32, 20]);

        view3d.width = 16;
        view3d.height = 10;
        view3d.resolution = 2;
        await renderFrame(app);
        expect([source.pixelWidth, source.pixelHeight], 'the same texels as before').toEqual([32, 20]);
        expect([extract.texture.width, extract.texture.height], 'a new logical size all the same').toEqual([16, 10]);
      });
    });
  }
});
