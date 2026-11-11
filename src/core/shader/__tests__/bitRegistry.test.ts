import { describe, expect, it } from 'vitest';

import { assertBindGroups, assertBitIdentity } from '~/core/shader/bitRegistry';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { ShaderDescriptor } from '~/core/shader/ShaderDescriptor';

describe('bitRegistry', () => {
  it('throws when two different bits share a name', () => {
    const a: ShaderBit = { name: 'collide', gpu: { fragment: { material: 'let x = 1.0;' } } };
    const b: ShaderBit = { name: 'collide', gpu: { fragment: { material: 'let x = 2.0;' } } };

    new ShaderDescriptor({ bitsGpu: [a], bitsGl: [a] });
    expect(() => new ShaderDescriptor({ bitsGpu: [b], bitsGl: [b] })).toThrow(/share the name 'collide'/);
  });

  it('accepts a recreated byte-identical bit (hot reload / double-bundled module)', () => {
    const make = (): ShaderBit => ({
      name: 'recreated',
      textures: ['recreatedMap'],
      gpu: { fragment: { material: 'let y = 1.0;' } },
    });

    new ShaderDescriptor({ bitsGpu: [make()], bitsGl: [make()] });
    expect(() => new ShaderDescriptor({ bitsGpu: [make()], bitsGl: [make()] })).not.toThrow();
    expect(() => assertBitIdentity(make()), 'the stamps on earlier copies stay out of the comparison').not.toThrow();
  });

  it('keys descriptors by template identity, since a template changes the compiled output', () => {
    const bit: ShaderBit = { name: 'tplBit' };
    const templateA: ShaderBitTemplate = { bindGroups: ['global'], gpu: '{{header}}A' };
    const templateB: ShaderBitTemplate = { bindGroups: ['global'], gpu: '{{header}}B' };

    const withA = new ShaderDescriptor({ bitsGpu: [bit], bitsGl: [bit], template: templateA });
    const withB = new ShaderDescriptor({ bitsGpu: [bit], bitsGl: [bit], template: templateB });
    const withNone = new ShaderDescriptor({ bitsGpu: [bit], bitsGl: [bit] });

    expect(withA.keyGpu).not.toBe(withB.keyGpu);
    expect(withA.keyGpu).not.toBe(withNone.keyGpu);

    const withAAgain = new ShaderDescriptor({ bitsGpu: [bit], bitsGl: [bit], template: templateA });
    expect(withAAgain.keyGpu, 'the same template object keys the same').toBe(withA.keyGpu);
  });

  it('keys a reused descriptor by the output locations of each update', () => {
    const bit: ShaderBit = { name: 'outputKeyBit' };
    const velocity = ['color', 'velocity'];
    const descriptor = new ShaderDescriptor({ bitsGpu: [bit], bitsGl: [bit], outputLocations: velocity });
    const velocityKey = descriptor.keyGpu;

    const normalKey = descriptor.update({ bitsGpu: [bit], bitsGl: [bit], outputLocations: ['color', 'normal'] }).keyGpu;
    expect(normalKey).not.toBe(velocityKey);
    expect(
      descriptor.update({ bitsGpu: [bit], bitsGl: [bit], outputLocations: ['color', 'velocity'] }).keyGpu,
      'a new list with the same names keys the same',
    ).toBe(velocityKey);
    expect(descriptor.update({ bitsGpu: [bit], bitsGl: [bit] }).keyGpu).toBe(
      new ShaderDescriptor({ bitsGpu: [bit], bitsGl: [bit] }).keyGpu,
    );
  });
});

describe('assertBindGroups', () => {
  const withCamera: ShaderBitTemplate = { bindGroups: [{ name: 'global', ubo: true }, 'camera', 'batch'], gpu: '' };
  const blockGlobal: ShaderBitTemplate = { bindGroups: [{ name: 'global', ubo: true }, 'camera', 'batch'] };
  const noBatch: ShaderBitTemplate = { bindGroups: [{ name: 'global', ubo: true }, 'camera'] };
  const otherBit: ShaderBit = { name: 'other', bindings: { global: { uTime: 'f32' } } };
  const cameraBit: ShaderBit = { name: 'cam', bindings: { camera: { uView: 'mat4x4<f32>' } } };
  const batchBit: ShaderBit = { name: 'perBatch', bindings: { batch: { uMatrix: 'mat4x4<f32>' } } };

  it('fails at compile, naming the flag, when the template declares a camera group nobody fills', () => {
    expect(() => assertBindGroups([otherBit], withCamera)).toThrow(/includeCamera/);
  });

  it('fails, naming the bit and the group, when a bit declares an engine group the template leaves out', () => {
    expect(() => assertBindGroups([otherBit, cameraBit, batchBit], noBatch)).toThrow(
      "The shader bit 'perBatch' declares the 'batch' bind group, but the shader template doesn't list it. " +
        "Add `'batch'` to the template's `bindGroups`.",
    );
  });

  it("names the uniform-block form when a bit declares 'global' and the template leaves it out, and that form passes", () => {
    const cameraOnly: ShaderBitTemplate = { bindGroups: ['camera'] };
    const fixed: ShaderBitTemplate = { bindGroups: [{ name: 'global', ubo: true }, 'camera'] };

    expect(() => assertBindGroups([otherBit, cameraBit], cameraOnly)).toThrow(
      "The shader bit 'other' declares the 'global' bind group, but the shader template doesn't list it. " +
        "Add `{ name: 'global', ubo: true }` to the template's `bindGroups`.",
    );
    expect(() => assertBindGroups([otherBit, cameraBit], fixed)).not.toThrow();
  });

  it('fails when the template lists an engine group with the wrong ubo', () => {
    const plainGlobal: ShaderBitTemplate = { bindGroups: ['global', 'camera', 'batch'] };
    const blockCamera: ShaderBitTemplate = {
      bindGroups: [
        { name: 'global', ubo: true },
        { name: 'camera', ubo: true },
      ],
    };

    expect(() => assertBindGroups([otherBit, cameraBit], plainGlobal)).toThrow(/\{ name: 'global', ubo: true \}/);
    expect(() => assertBindGroups([otherBit, cameraBit], blockCamera)).toThrow(/'camera'.*plain uniforms/);
  });

  it('passes a template that lists what its bits declare', () => {
    expect(() => assertBindGroups([otherBit, cameraBit, batchBit], blockGlobal)).not.toThrow();
  });
});
