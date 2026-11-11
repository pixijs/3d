import { getApp } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { ShaderBit } from '~/core/shader/ShaderBit';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const tintBit: ShaderBit = {
  name: 'mat2x2TintTest',
  bindings: { material: { tint: 'mat2x2<f32>', gain: 'f32' } },
  gpu: {
    fragment: {
      material: /* wgsl */ `
  albedo = vec3<f32>(material.tint * vec2<f32>(material.gain), 0.0);
`,
    },
  },
  gl: {
    fragment: {
      material: /* glsl */ `
  albedo = vec3(material.tint * vec2(material.gain), 0.0);
`,
    },
  },
};

const TINT_COLUMNS = [0.5, 0, 0.5, 0.5];

describe('mat2x2 material field', () => {
  it.each(['webgl', 'webgpu'] as const)(
    'reaches the %s shader as the two columns the CPU wrote',
    async (preference) => {
      const app = await getApp<Renderer>({
        id: `material-mat2x2-${preference}`,
        appOptions: { preference, width: 32, height: 32, resolution: 1 },
      });
      try {
        const view3d = new View3D({ toneMapping: 'none', width: 32, height: 32 });
        app.stage.addChild(view3d);
        const material = new FlatMaterial({ extraBits: [tintBit] });
        material.data.tint = TINT_COLUMNS;
        material.data.gain = 1;
        view3d.root.addChild(new Mesh3D({ geometry: new PlaneGeometry({ width: 4, height: 4 }), material }));
        view3d.camera.position.set(0, 0, 4);

        app.render();
        const { pixels, width } = app.renderer.extract.pixels(view3d);
        const centre = (16 * width + 16) * 4;
        const [r, g, b] = pixels.subarray(centre, centre + 3);

        expect(r).toBe(255);
        expect(g).toBeGreaterThanOrEqual(126);
        expect(g).toBeLessThanOrEqual(130);
        expect(b).toBe(0);

        view3d.destroy({ children: true });
      } finally {
        app.destroy();
      }
    },
  );
});
