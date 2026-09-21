import { describe, expect, it } from 'vitest';

import type { GltfFormat } from '~/assets/loaders/gltf/GltfFormat';
import { processLights } from '~/assets/loaders/gltf/process/processLights';
import { processNodes } from '~/assets/loaders/gltf/process/processNodes';
import type { Scene3DDescriptor } from '~/assets/Scene3DDescriptor';
import { writeLight } from '~/core/LightDataList';
import { srgbToLinear } from '~/materials/BaseMaterial3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';

// Loader colours are pre-encoded to display space so the upload-time decode
// lands the spec-linear value back on the GPU (see issue #179's round trip).
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
          { type: 'point', color: [0, 1, 0] }, // no intensity, no range
          {
            type: 'spot',
            color: [0, 0, 1],
            intensity: 5,
            range: 12,
            spot: { innerConeAngle: Math.PI / 8, outerConeAngle: Math.PI / 4 },
          },
          {
            type: 'spot',
            // Degenerate cones: both 0. Should not produce NaN penumbra.
            spot: { innerConeAngle: 0, outerConeAngle: 0 },
          },
          {
            type: 'spot',
            // Out-of-spec: inner > outer. Derived penumbra would go negative
            // without clamping, which would invert the inner/outer relationship.
            spot: { innerConeAngle: Math.PI / 3, outerConeAngle: Math.PI / 6 },
          },
        ],
      },
    },
    nodes: [
      { name: 'dir', extensions: { KHR_lights_punctual: { light: 0 } } },
      { name: 'pnt', extensions: { KHR_lights_punctual: { light: 1 } } },
      { name: 'spt', extensions: { KHR_lights_punctual: { light: 2 } } },
    ],
  }) as unknown as GltfFormat;

describe('GLTF KHR_lights_punctual', () => {
  it('maps lights with spec-correct defaults', () => {
    const descriptor: Scene3DDescriptor = {};
    processLights(buildGltf(), descriptor);

    expect(descriptor.lights).toHaveLength(5);

    const [dir, pnt, spt, degen, oob] = descriptor.lights!;

    // directional
    expect(dir.type).toBe(0);
    expectRoundTripsTo(dir.color, [1, 0.5, 0.25]);
    expect(dir.intensity).toBe(2);

    // point with omitted range → 0 (infinite in pixi-3d), not undefined
    expect(pnt.type).toBe(1);
    expect(pnt.range).toBe(0);
    expectRoundTripsTo(pnt.color, [0, 1, 0]);

    // spot with inner/outer cones → coneAngle = outer in degrees, penumbra = 1 - inner/outer
    expect(spt.type).toBe(2);
    expect(spt.range).toBe(12);
    expect(spt.coneAngle).toBeCloseTo(45);
    expect(spt.penumbra).toBeCloseTo(0.5);

    // degenerate cones must not produce NaN
    expect(degen.penumbra).toBe(0);

    // out-of-spec inner > outer must clamp to valid [0, 1] range (not go negative)
    expect(oob.penumbra).toBeGreaterThanOrEqual(0);
    expect(oob.penumbra).toBeLessThanOrEqual(1);
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

  it('does nothing when the extension is absent', () => {
    const gltf = { asset: { version: '2.0' } } as unknown as GltfFormat;
    const descriptor: Scene3DDescriptor = {};
    processLights(gltf, descriptor);
    expect(descriptor.lights).toBeUndefined();
  });

  it('tags nodes referencing a punctual light via KHR_lights_punctual', () => {
    const descriptor: Scene3DDescriptor = {};
    processNodes(buildGltf(), descriptor);

    expect(descriptor.nodes).toHaveLength(3);
    descriptor.nodes!.forEach((node, i) => {
      expect(node.light).toBe(i);
    });
  });
});

describe('light colour upload', () => {
  it('decodes display-space light colours to linear light, premultiplied by intensity', () => {
    const light = new DirectionalLight({ color: 0xfff4e0, intensity: 2 });
    light.updateLocalTransform();

    const buffer = new Float32Array(16);
    writeLight(light, buffer, 0);

    expect(buffer[4]).toBeCloseTo(srgbToLinear(1) * 2, 5);
    expect(buffer[5]).toBeCloseTo(srgbToLinear(0xf4 / 255) * 2, 5);
    expect(buffer[6]).toBeCloseTo(srgbToLinear(0xe0 / 255) * 2, 5);
  });

  it('lands glTF spec-linear light colours on the GPU unchanged (loader + upload round trip)', () => {
    const descriptor: Scene3DDescriptor = {};
    processLights(buildGltf(), descriptor);

    const light = new DirectionalLight({ ...descriptor.lights![0], color: descriptor.lights![0].color });
    light.updateLocalTransform();

    const buffer = new Float32Array(16);
    writeLight(light, buffer, 0);

    // Spec colour [1, 0.5, 0.25] × intensity 2 — not double-converted, not 8-bit quantized.
    expect(buffer[4]).toBeCloseTo(2, 5);
    expect(buffer[5]).toBeCloseTo(1, 5);
    expect(buffer[6]).toBeCloseTo(0.5, 5);
  });
});
