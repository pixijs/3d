import { describe, expect, test } from 'vitest';

import { Scene3DSource } from '~/assets/Scene3DSource';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { PointLight } from '~/scene/lights/PointLight';
import { SpotLight } from '~/scene/lights/SpotLight';
import { Model3D } from '~/scene/Model3D';

describe('Light options', () => {
  test('an explicit undefined keeps the default', () => {
    const spot = new SpotLight({ intensity: undefined, coneAngle: undefined, label: undefined });

    expect(spot.intensity).toBe(1);
    expect(spot.coneAngle).toBe(60);
    expect(spot.label).toBe('SpotLight');
  });

  test('glTF lights get light options only, and their label from the node', () => {
    const source = new Scene3DSource({
      scenes: [{ name: 'Scene', children: [0] }],
      nodes: [{ label: 'Lamp', children: [], light: 0 }],
      lights: [{ name: 'lampLight', type: 2, intensity: 3, range: 5, coneAngle: 36, penumbra: 0.2 }],
    });

    const spot = Model3D.from(source).children[0] as SpotLight;

    expect(spot).toBeInstanceOf(SpotLight);
    expect(spot.type).toBe('spot');
    expect(spot.label).toBe('Lamp');
    expect('name' in spot).toBe(false);
    expect(spot.intensity).toBe(3);
    expect(spot.coneAngle).toBe(36);
  });

  test('glTF lights take only the options their kind declares', () => {
    const source = new Scene3DSource({
      scenes: [{ name: 'Scene', children: [0, 1, 2] }],
      nodes: [
        { label: 'Sun', children: [], light: 0 },
        { label: 'Bulb', children: [], light: 1 },
        { label: 'Spot', children: [], light: 2 },
      ],
      lights: [
        { type: 0, range: 5, penumbra: 0.2 },
        { type: 1, range: 5, penumbra: 0.2 },
        { type: 2, range: 5, penumbra: 0.2 },
      ],
    });

    const { children } = Model3D.from(source);
    const sun = children[0] as DirectionalLight;
    const bulb = children[1] as PointLight;
    const spot = children[2] as SpotLight;

    expect(sun).toBeInstanceOf(DirectionalLight);
    expect('range' in sun).toBe(false);
    expect('penumbra' in sun).toBe(false);

    expect(bulb).toBeInstanceOf(PointLight);
    expect(bulb.range).toBe(5);
    expect('penumbra' in bulb).toBe(false);

    expect(spot).toBeInstanceOf(SpotLight);
    expect(spot.range).toBe(5);
    expect(spot.penumbra).toBe(0.2);
  });
});
