import { afterEach, describe, expect, it } from 'vitest';

import { passBitRegistry } from '~/core/render-passes/passBitRegistry';
import { ToonMaterial } from '~/extras/materials/toon/ToonMaterial';

describe('ToonMaterial', () => {
  const defaults = { ...ToonMaterial.defaultOptions };

  afterEach(() => {
    ToonMaterial.defaultOptions = { ...defaults };
  });

  it('packs its defaults from defaultOptions', () => {
    const material = new ToonMaterial();

    expect(material.data.bands).toBe(3);
    expect(material.data.specularSize).toBeCloseTo(0.15);
    expect(material.data.rimPower).toBe(3);
    expect(material.data.rimIntensity).toBeCloseTo(0.4);
    expect(material._passBit & passBitRegistry.getOrAllocate('outline')).not.toBe(0);

    material.destroy();
  });

  it('picks up changed defaults and ignores explicit undefined', () => {
    ToonMaterial.defaultOptions.bands = 5;
    ToonMaterial.defaultOptions.outline = false;

    const material = new ToonMaterial({ bands: undefined, rimPower: 2 });

    expect(material.data.bands).toBe(5);
    expect(material.data.rimPower).toBe(2);
    expect(material._passBit & passBitRegistry.getOrAllocate('outline')).toBe(0);

    material.destroy();
  });
});
