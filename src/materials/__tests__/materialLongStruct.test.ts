import { getApp } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { ShaderBit } from '~/core/shader/ShaderBit';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const PADDING_FIELDS = 20;

function makeLongBit(): ShaderBit {
  const material: Record<string, 'vec4<f32>'> = {};
  for (let i = 0; i < PADDING_FIELDS; i++) material[`pad${i}`] = 'vec4<f32>';
  material.colour = 'vec4<f32>';

  return {
    name: 'longStructTest',
    bindings: { material },
    gpu: { fragment: { material: /* wgsl */ `  albedo = material.colour.rgb + material.pad0.rgb;\n` } },
    gl: { fragment: { material: /* glsl */ `  albedo = material.colour.rgb + material.pad0.rgb;\n` } },
  };
}

describe('a material struct of many texels', () => {
  it.each(['webgl', 'webgpu'] as const)('reaches the %s shader whole, beside a short material', async (preference) => {
    const app = await getApp<Renderer>({
      id: `material-long-struct-${preference}`,
      appOptions: { preference, width: 64, height: 32, resolution: 1 },
    });
    try {
      const view3d = new View3D({ toneMapping: 'none', width: 64, height: 32 });
      app.stage.addChild(view3d);

      const short = new FlatMaterial({ baseColor: 0x0000ff });
      const long = new FlatMaterial({ extraBits: [makeLongBit()] });
      long.data.pad0 = [0, 0.5, 0, 0];
      long.data.colour = [1, 0, 0, 1];
      expect(long.data._f32.length).toBe((PADDING_FIELDS + 1) * 4 + short.data._f32.length);

      const geometry = new PlaneGeometry({ width: 2, height: 2 });
      const left = new Mesh3D({ geometry, material: short });
      const right = new Mesh3D({ geometry, material: long });
      left.position.x = -1;
      right.position.x = 1;
      view3d.root.addChild(left, right);
      view3d.camera.position.set(0, 0, 3);

      app.render();
      const { pixels, width } = app.renderer.extract.pixels(view3d);
      const at = (x: number) => Array.from(pixels.subarray((16 * width + x) * 4, (16 * width + x) * 4 + 3));

      expect(at(16), 'the short material').toEqual([0, 0, 255]);
      const [r, g, b] = at(48);
      expect(r, 'the long material, from its last field').toBe(255);
      expect(g, 'the long material, from its first field').toBeGreaterThanOrEqual(126);
      expect(g).toBeLessThanOrEqual(130);
      expect(b).toBe(0);

      view3d.destroy({ children: true });
    } finally {
      app.destroy();
    }
  });
});
