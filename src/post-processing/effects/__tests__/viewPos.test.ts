import { getApp, renderFrame } from '@test-utils';
import { AlphaFilter } from 'pixi.js';
import type { Application, Renderer } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';

import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { PostEffect } from '~/post-processing/effects/PostEffect';
import type { EffectFragment } from '~/post-processing/effects/PostEffect';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 32;

class ViewPosSign extends PostEffect {
  constructor() {
    super({ stage: 'afterToneMapping' });
  }
  protected readonly fragment: EffectFragment = {
    gpu: `
fn effect(uv: vec2<f32>) -> vec4<f32> {
  let p = viewPos(uv);
  return vec4<f32>(step(0.0, p.y), step(0.0, p.x), 0.0, 1.0);
}
`,
    gl: `
vec4 effect(vec2 uv) {
  vec3 p = viewPos(uv);
  return vec4(step(0.0, p.y), step(0.0, p.x), 0.0, 1.0);
}
`,
  };
}

function at(pixels: Uint8ClampedArray, x: number, y: number): [number, number] {
  const i = (y * SIZE + x) * 4;
  return [pixels[i], pixels[i + 1]];
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`viewPos (${preference})`, () => {
    let app: Application<Renderer>;
    let view3d: View3D;

    afterEach(() => {
      view3d?.destroy(true);
      app?.destroy();
    });

    for (const target of ['canvas', '2D filter'] as const) {
      it(`gives view space with Y up and X right, drawing onto the ${target}`, async () => {
        app = await getApp<Renderer>({
          id: `view-pos-${target.replace(' ', '-')}-${preference}`,
          appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x000000, autoStart: false },
        });
        view3d = new View3D({ width: SIZE, height: SIZE, passes: [new ViewPosSign()] });
        if (target === '2D filter') view3d.filters = [new AlphaFilter({ alpha: 1 })];
        app.stage.addChild(view3d);
        view3d.camera.position.set(0, 0, 4);
        view3d.root.addChild(
          new Mesh3D({ geometry: new PlaneGeometry({ width: 40, height: 40 }), material: new FlatMaterial() }),
        );

        const pixels = await renderFrame(app);
        expect(at(pixels, 4, 4), 'top left: above, to the left').toEqual([255, 0]);
        expect(at(pixels, SIZE - 5, 4), 'top right: above, to the right').toEqual([255, 255]);
        expect(at(pixels, 4, SIZE - 5), 'bottom left: below, to the left').toEqual([0, 0]);
        expect(at(pixels, SIZE - 5, SIZE - 5), 'bottom right: below, to the right').toEqual([0, 255]);
      });
    }
  });
}
