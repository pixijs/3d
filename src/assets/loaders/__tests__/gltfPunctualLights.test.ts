import { describe, expect, it } from 'vitest';

import type { GltfFormat } from '~/assets/loaders/gltf/GltfFormat';
import { processLights } from '~/assets/loaders/gltf/process/processLights';
import type { Scene3DDescriptor } from '~/assets/Scene3DDescriptor';
import { writeLight } from '~/core/LightDataList';
import { srgbToLinear } from '~/materials/BaseMaterial3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';

/** Checks that a loader colour, encoded to sRGB, decodes back to the file's linear value */
const expectRoundTripsTo = (encoded: unknown, linear: number[]) => {
  const channels = encoded as number[];
  expect(channels).toHaveLength(3);
  channels.forEach((channel, i) => expect(srgbToLinear(channel)).toBeCloseTo(linear[i], 6));
};

const buildGltf = (): GltfFormat =>
  ({
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_lights_punctual'],
    extensions: {
      KHR_lights_punctual: {
        lights: [
          { type: 'directional', color: [1, 0.5, 0.25], intensity: 2 },
          { type: 'point', color: [0, 1, 0] },
          {
            type: 'spot',
            color: [0, 0, 1],
            intensity: 5,
            range: 12,
            spot: { innerConeAngle: Math.PI / 8, outerConeAngle: Math.PI / 4 },
          },
          {
            type: 'spot',
            spot: { innerConeAngle: 0, outerConeAngle: 0 },
          },
          {
            type: 'spot',
            spot: { innerConeAngle: Math.PI / 3, outerConeAngle: Math.PI / 6 },
          },
        ],
      },
    },
  }) as unknown as GltfFormat;

describe('GLTF KHR_lights_punctual', () => {
  it('maps lights with spec-correct defaults, and a zero or inverted spot cone to a valid penumbra', () => {
    const descriptor: Scene3DDescriptor = {};
    processLights(buildGltf(), descriptor);

    expect(descriptor.lights).toHaveLength(5);

    const [directional, point, spot, zeroCone, innerWiderThanOuter] = descriptor.lights!;

    expect(directional.type).toBe(0);
    expectRoundTripsTo(directional.color, [1, 0.5, 0.25]);
    expect(directional.intensity).toBe(2);

    expect(point.type).toBe(1);
    expect(point.range).toBe(0);
    expectRoundTripsTo(point.color, [0, 1, 0]);

    expect(spot.type).toBe(2);
    expect(spot.range).toBe(12);
    expect(spot.coneAngle).toBeCloseTo(45);
    expect(spot.penumbra).toBeCloseTo(0.5);

    expect(zeroCone.penumbra).toBe(0);

    expect(innerWiderThanOuter.penumbra).toBeGreaterThanOrEqual(0);
    expect(innerWiderThanOuter.penumbra).toBeLessThanOrEqual(1);
  });

  it('defaults color to white when omitted', () => {
    const gltf = {
      asset: { version: '2.0' },
      extensions: {
        KHR_lights_punctual: { lights: [{ type: 'directional' }] },
      },
    } as unknown as GltfFormat;

    const descriptor: Scene3DDescriptor = {};
    processLights(gltf, descriptor);

    expectRoundTripsTo(descriptor.lights![0].color, [1, 1, 1]);
  });
});

describe('light colour upload', () => {
  it('lands glTF spec-linear light colours on the GPU unchanged (loader + upload round trip)', () => {
    const descriptor: Scene3DDescriptor = {};
    processLights(buildGltf(), descriptor);

    const light = new DirectionalLight({ ...descriptor.lights![0], color: descriptor.lights![0].color });
    light.updateLocalTransform();

    const buffer = new Float32Array(16);
    writeLight(light, buffer, 0);

    expect(buffer[4]).toBeCloseTo(2, 5);
    expect(buffer[5]).toBeCloseTo(1, 5);
    expect(buffer[6]).toBeCloseTo(0.5, 5);
  });
});
