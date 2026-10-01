import { describe, expect, it } from 'vitest';

import { srgbToLinear } from '~/materials/BaseMaterial3D';
import { Material3D } from '~/materials/pbr/Material3D';

describe('material colour inputs are display-space and decode sRGB → linear at write', () => {
  const linear = srgbToLinear(0.5);

  it('decodes all five colour inputs from constructor options (alpha raw)', () => {
    const material = new Material3D({
      baseColor: [0.5, 0.5, 0.5],
      alpha: 0.5,
      emissive: { color: [0.5, 0.5, 0.5] },
      sheen: { color: [0.5, 0.5, 0.5] },
      specular: { color: [0.5, 0.5, 0.5] },
      transmission: { attenuationColor: [0.5, 0.5, 0.5] },
    });

    const baseColor = material.data.baseColor;
    const emissive = material.data.emissive!;
    expect(baseColor[0]).toBeCloseTo(linear, 5);
    expect(baseColor[3]).toBe(0.5);
    expect(emissive[0]).toBeCloseTo(linear, 5);
    expect(material.data.sheenParams![0]).toBeCloseTo(linear, 5);
    expect(material.data.specularParams![0]).toBeCloseTo(linear, 5);
    expect(material.data.attenuationColorIrid![0]).toBeCloseTo(linear, 5);
  });

  it('decodes setter writes identically to constructor seeds', () => {
    const material = new Material3D({
      sheen: {},
      specular: {},
      transmission: {},
    });

    material.sheen!.color = [0.5, 0.5, 0.5];
    material.specular!.color = [0.5, 0.5, 0.5];
    material.transmission!.attenuationColor = [0.5, 0.5, 0.5];

    expect(material.data.sheenParams![0]).toBeCloseTo(linear, 5);
    expect(material.data.specularParams![0]).toBeCloseTo(linear, 5);
    expect(material.data.attenuationColorIrid![0]).toBeCloseTo(linear, 5);
  });

  it('reads back the canonical hex, tint-style, truncating float channels (0.5 → 0x7f)', () => {
    const material = new Material3D({
      sheen: {},
      transmission: {},
    });

    material.sheen!.color = 'red';
    expect(material.sheen!.color).toBe(0xff0000);
    material.transmission!.attenuationColor = [0.5, 0.5, 0.5];
    expect(material.transmission!.attenuationColor).toBe(0x7f7f7f);
  });

  it('defaults stay exact: white tints land as 1, black emissive as 0', () => {
    const material = new Material3D({
      emissive: { color: [0, 0, 0] },
      sheen: {},
      specular: {},
      transmission: {},
    });

    expect(material.data.emissive![0]).toBe(0);
    expect(material.sheen!.color).toBe(0xffffff);
    expect(material.specular!.color).toBe(0xffffff);
    expect(material.transmission!.attenuationColor).toBe(0xffffff);
    expect(material.data.sheenParams![0]).toBe(1);
  });
});
