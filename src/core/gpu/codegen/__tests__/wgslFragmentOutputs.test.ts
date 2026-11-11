import { wgslCompilationErrors } from '@test-utils';
import { extractFragmentOutputMaskFromGpuProgram } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';

const outputsTemplate: ShaderBitTemplate = {
  bindGroups: [],
  gpu: /* wgsl */ `
{{header}}

@fragment
fn mainFragment(input: FragmentInput) -> FragmentOutput {
  {{fragmentDeclareOutputs}}
  {{fragmentEnd}}
  {{fragmentWriteOutputs}}
}
`,
};

const colorBit: ShaderBit = {
  name: 'testOutputsColor',
  outputs: { color: 'vec4<f32>' },
  gpu: { fragment: { end: 'outputs.color = vec4<f32>(1.0, 0.5, 0.25, 1.0);' } },
};

const velocityBit: ShaderBit = {
  name: 'testOutputsVelocity',
  outputs: { velocity: 'vec2<f32>' },
  gpu: { fragment: { end: 'outputs.velocity = input.position.xy * 0.001;' } },
};

function structFields(source: string, name: string): string[] {
  const match = new RegExp(`struct ${name} \\{([^}]*)\\}`).exec(source);

  expect(match, `struct ${name}`).not.toBeNull();

  return match![1]
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function readOutputs(source: string): number | null {
  return extractFragmentOutputMaskFromGpuProgram({ source, entryPoint: 'mainFragment' });
}

describe('fragment outputs in WGSL', () => {
  it('throws when two bits give one output different types, naming the output and both bits', () => {
    const wideVelocityBit: ShaderBit = { name: 'testOutputsWideVelocity', outputs: { velocity: 'vec4<f32>' } };

    expect(() =>
      compileWgslSource({ bits: [colorBit, velocityBit, wideVelocityBit], template: outputsTemplate }),
    ).toThrowError(
      /"velocity" is "vec2<f32>" in bit "testOutputsVelocity" and "vec4<f32>" in bit "testOutputsWideVelocity"/,
    );
  });

  it('accepts two bits that declare one output with the same type', () => {
    const sameVelocityBit: ShaderBit = { name: 'testOutputsSameVelocity', outputs: { velocity: 'vec2<f32>' } };
    const { fragment } = compileWgslSource({
      bits: [colorBit, velocityBit, sameVelocityBit],
      template: outputsTemplate,
      outputLocations: ['color', 'velocity'],
    });

    expect(structFields(fragment.source, 'Outputs')).toEqual(['color: vec4<f32>,', 'velocity: vec2<f32>,']);
  });

  it('keeps a location free when no bit declares its output, so the draw leaves that attachment alone', () => {
    const { fragment } = compileWgslSource({
      bits: [colorBit, velocityBit],
      template: outputsTemplate,
      outputLocations: ['color', 'normal', 'velocity'],
    });

    expect(structFields(fragment.source, 'FragmentOutput')).toEqual([
      '@location(0) color: vec4<f32>,',
      '@location(2) velocity: vec2<f32>,',
    ]);
    expect(readOutputs(fragment.source), 'pixi reads attachment 1 as not written').toBe(0b101);
  });

  it("throws, naming the bit, on an output name a shader field can't carry", () => {
    const reservedBit: ShaderBit = { name: 'myOutputBit', outputs: { output: 'vec4<f32>' } };
    expect(() =>
      compileWgslSource({ bits: [colorBit, reservedBit], template: outputsTemplate, outputLocations: ['color'] }),
    ).toThrowError(/Bit 'myOutputBit': 'output' can't name a fragment output, because WGSL or GLSL reserves the word/);
  });

  it('leaves a template without the output slots as it is, whatever the bits declare and the locations name', () => {
    const plainTemplate: ShaderBitTemplate = {
      bindGroups: [],
      gpu: '{{header}}\n@fragment fn mainFragment() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }',
    };
    const { fragment } = compileWgslSource({
      bits: [{ name: 'testOutputsVelocityDeclared', outputs: { velocity: 'vec2<f32>' } }],
      template: plainTemplate,
      outputLocations: ['missing'],
    });

    expect(fragment.source).not.toContain('struct Outputs');
    expect(fragment.source).not.toContain('struct FragmentOutput');
  });

  it('compiles on the device with an output given a location and with it left out', async () => {
    const adapter = await navigator.gpu.requestAdapter();
    expect(adapter).toBeTruthy();
    const device = await adapter!.requestDevice();

    try {
      for (const outputs of [['color'], ['color', 'velocity'], ['velocity', 'color']]) {
        const { fragment } = compileWgslSource({
          bits: [colorBit, velocityBit],
          template: outputsTemplate,
          outputLocations: outputs,
        });

        expect(await wgslCompilationErrors(device, fragment.source), outputs.join(',')).toEqual([]);
      }
    } finally {
      device.destroy();
    }
  });
});
