import { beforeEach, describe, expect, it } from 'vitest';

import { assertBitIdentity, assertCameraGroupProvided, resetBitRegistry } from '~/core/shader/bitRegistry';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { ShaderDescriptor } from '~/core/shader/ShaderDescriptor';

describe('bitRegistry', () => {
  beforeEach(() => resetBitRegistry());

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

    // The registry's bookkeeping stamps (_identityChecked / _contentSnapshot)
    // must not poison the content comparison for later recreations.
    expect(() => assertBitIdentity(make())).not.toThrow();
  });

  it('re-checking a registered bit is a stamped no-op', () => {
    const bit: ShaderBit = { name: 'stamped' };

    assertBitIdentity(bit);
    expect(bit._identityChecked).toBe(true);
    expect(() => assertBitIdentity(bit)).not.toThrow();
  });

  it('includes template identity in descriptor keys', () => {
    const bit: ShaderBit = { name: 'tplBit' };
    const templateA: ShaderBitTemplate = { bindGroups: ['global'], gpu: '{{header}}A' };
    const templateB: ShaderBitTemplate = { bindGroups: ['global'], gpu: '{{header}}B' };

    const withA = new ShaderDescriptor({ bitsGpu: [bit], bitsGl: [bit], template: templateA });
    const withB = new ShaderDescriptor({ bitsGpu: [bit], bitsGl: [bit], template: templateB });
    const withNone = new ShaderDescriptor({ bitsGpu: [bit], bitsGl: [bit] });

    // Same bits, different template → different compiled output → different key.
    expect(withA.keyGpu).not.toBe(withB.keyGpu);
    expect(withA.keyGpu).not.toBe(withNone.keyGpu);

    // The uid is stamped on the template, so reuse keys identically.
    const withAAgain = new ShaderDescriptor({ bitsGpu: [bit], bitsGl: [bit], template: templateA });
    expect(withAAgain.keyGpu).toBe(withA.keyGpu);
  });
});

describe('assertCameraGroupProvided', () => {
  const withCamera: ShaderBitTemplate = { bindGroups: ['global', 'camera', 'batch'], gpu: '' };
  const withoutCamera: ShaderBitTemplate = { bindGroups: ['global', 'batch'], gpu: '' };
  const cameraBit: ShaderBit = { name: 'cam', bindings: { camera: { uViewMatrix: 'mat4x4<f32>' } } };
  const otherBit: ShaderBit = { name: 'other', bindings: { global: { uTime: 'f32' } } };

  it("passes when a bit fills the template's camera group", () => {
    expect(() => assertCameraGroupProvided([otherBit, cameraBit], withCamera)).not.toThrow();
  });

  it('passes when the template declares no camera group, whatever the bits', () => {
    expect(() => assertCameraGroupProvided([otherBit], withoutCamera)).not.toThrow();
  });

  it('fails at compile, naming the flag, when the template declares a camera group nobody fills', () => {
    expect(() => assertCameraGroupProvided([otherBit], withCamera)).toThrow(/includeCamera/);
  });
});
