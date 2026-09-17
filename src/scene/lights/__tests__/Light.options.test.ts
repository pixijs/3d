import { describe, expect, test } from 'vitest';

import { Scene3DSource } from '~/assets/Scene3DSource';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { PointLight } from '~/scene/lights/PointLight';
import { SpotLight } from '~/scene/lights/SpotLight';
import { Model3D } from '~/scene/Model3D';

describe('Light options', () => {
  test('each light kind defaults its label to the class name', () => {
    expect(new AmbientLight().label).toBe('AmbientLight');
    expect(new DirectionalLight().label).toBe('DirectionalLight');
    expect(new PointLight().label).toBe('PointLight');
    expect(new SpotLight().label).toBe('SpotLight');
  });

  test('forwards inherited Container3D options to the base', () => {
    const options = { label: 'fill', position: { x: 1, y: 2, z: 3 }, eventMode: 'static' } as const;
    const lights = [
      new AmbientLight(options),
      new DirectionalLight(options),
      new PointLight(options),
      new SpotLight(options),
    ];

    for (const light of lights) {
      expect(light.label).toBe('fill');
      expect(light.position.z).toBe(3);
      expect(light.eventMode).toBe('static');
    }
  });

  test('applies the documented defaults', () => {
    const ambient = new AmbientLight();
    expect(ambient.color.toNumber()).toBe(0xffffff);
    expect(ambient.intensity).toBe(0.5);

    const sun = new DirectionalLight();
    expect(sun.intensity).toBe(1);
    expect(sun.castShadow).toBe(false);

    expect(new PointLight().range).toBe(0);

    const spot = new SpotLight();
    expect(spot.range).toBe(0);
    expect(spot.coneAngle).toBe(60);
    expect(spot.penumbra).toBe(0);
    expect(spot.castShadow).toBe(false);
  });

  test('an explicit undefined keeps the default', () => {
    const spot = new SpotLight({ intensity: undefined, coneAngle: undefined, label: undefined });

    expect(spot.intensity).toBe(1);
    expect(spot.coneAngle).toBe(60);
    expect(spot.label).toBe('SpotLight');
  });

  test('own options resolve onto the light', () => {
    const spot = new SpotLight({
      color: 0xff0000,
      intensity: 4,
      range: 10,
      coneAngle: 30,
      penumbra: 0.5,
      castShadow: true,
    });

    expect(spot.color.toNumber()).toBe(0xff0000);
    expect(spot.intensity).toBe(4);
    expect(spot.range).toBe(10);
    expect(spot.coneAngle).toBe(30);
    expect(spot.penumbra).toBe(0.5);
    expect(spot.castShadow).toBe(true);
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
