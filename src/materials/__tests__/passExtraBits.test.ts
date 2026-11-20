import { getApp, renderFrame } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { ShaderBit } from '~/core/shader/ShaderBit';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { BaseMaterial3D } from '~/materials/BaseMaterial3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 64;

const glowBit: ShaderBit = {
  name: 'passExtraBitsGlow',
  bindings: { material: { glowStrength: 'f32' } },
  textures: ['glowMap'],
  gpu: { fragment: { end: 'finalColor = vec3<f32>(0.0, 1.0 + material.glowStrength, 0.0);' } },
  gl: { fragment: { end: 'finalColor = vec3(0.0, 1.0 + material.glowStrength, 0.0);' } },
};

interface GlowData {
  glowStrength: number;
}

describe("a material's pass entry with extraBits", () => {
  it("lays the entry's field and texture out with the material's own", () => {
    const material = new Material3D({ baseColor: 0xff0000, passes: { glow: { extraBits: [glowBit] } } });
    const data = material.data as unknown as GlowData;

    expect(data.glowStrength).toBe(0);
    data.glowStrength = 0.5;
    expect(data.glowStrength).toBe(0.5);
    expect(material._materialStructSnapshot).toContain('glowStrength');
    expect(material._slotByName.glowMap, 'the texture takes the slot after the material’s own').toBe(
      material._textures.length - 1,
    );
  });

  it('lays a bit out once when two entries list it', () => {
    const entry = { extraBits: [glowBit] };

    expect(() => new Material3D({ passes: { glow: entry, afterglow: entry } })).not.toThrow();
  });

  it('lays out the entries of a material built from a raw descriptor', () => {
    const plainBit: ShaderBit = { name: 'passExtraBitsPlain' };
    const material = new BaseMaterial3D({
      descriptor: { bitsGpu: [plainBit], bitsGl: [plainBit] },
      passes: { glow: { extraBits: [glowBit] } },
    });

    expect((material.data as unknown as GlowData).glowStrength).toBe(0);
    const view3d = new View3D({ width: SIZE, height: SIZE });

    expect(
      material.getPrimaryDescriptor(view3d).bitsGpu,
      "the entry's bit stays out of the material's own list",
    ).toEqual([plainBit]);
  });
});

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`a material's pass entry with extraBits (${preference})`, () => {
    it("draws its main pass without the entry's code", async () => {
      const app = await getApp<Renderer>({
        id: `pass-extra-bits-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x0000ff },
      });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE });
        view3d.camera.position.set(0, 0, 3);
        app.stage.addChild(view3d);
        view3d.root.addChild(
          new Mesh3D({
            geometry: new CubeGeometry({ width: 2, height: 2, depth: 2 }),
            material: new Material3D({ baseColor: 0xff0000, passes: { glow: { extraBits: [glowBit] } } }),
          }),
        );

        const pixels = await renderFrame(app);
        const centre = (SIZE / 2) * SIZE * 4 + (SIZE / 2) * 4;
        const [r, g, b] = [pixels[centre], pixels[centre + 1], pixels[centre + 2]];

        expect(b, `the cube covers the centre: rgb(${r}, ${g}, ${b})`).toBeLessThan(128);
        expect(g, "the glow bit's green isn't drawn").toBeLessThan(128);
      } finally {
        app.destroy();
      }
    });
  });
}
