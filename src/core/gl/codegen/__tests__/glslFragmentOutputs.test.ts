import { afterAll, describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';

const outputsTemplate: ShaderBitTemplate = {
  bindGroups: [],
  gl: {
    vertex: /* glsl */ `#version 300 es
{{header}}
void main() {
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
}`,
    fragment: /* glsl */ `#version 300 es
{{header}}
void main() {
  {{declareOutputs}}
  {{end}}
  {{writeOutputs}}
}`,
  },
};

const colorBit: ShaderBit = {
  name: 'testGlOutputsColor',
  outputs: { color: 'vec4<f32>' },
  gl: { fragment: { end: 'outputs.color = vec4(1.0, 0.5, 0.25, 1.0);' } },
};

const velocityBit: ShaderBit = {
  name: 'testGlOutputsVelocity',
  outputs: { velocity: 'vec2<f32>' },
  gl: { fragment: { end: 'outputs.velocity = gl_FragCoord.xy * 0.001;' } },
};

function compile(bits: ShaderBit[], outputs?: string[]): { vertex: string; fragment: string } {
  return compileGlslSource({ bits, template: outputsTemplate, useLocations: false, outputLocations: outputs });
}

function outDeclarations(fragment: string): string[] {
  return fragment.split('\n').filter((line) => /\bout\b/.test(line));
}

const gl = document.createElement('canvas').getContext('webgl2')!;

afterAll(() => gl.getExtension('WEBGL_lose_context')?.loseContext());

function linkLog(vertex: string, fragment: string): string {
  const program = gl.createProgram();
  const shaders = [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const;
  const logs: string[] = [];

  for (const [type, source] of shaders) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) logs.push(gl.getShaderInfoLog(shader) ?? 'compile failed');
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }

  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) logs.push(gl.getProgramInfoLog(program) ?? 'link failed');
  gl.deleteProgram(program);

  return logs.join('\n');
}

describe('fragment outputs in GLSL', () => {
  it('keeps a location free when no bit declares its output, so the draw leaves that attachment alone', () => {
    const { vertex, fragment } = compile([colorBit, velocityBit], ['color', 'normal', 'velocity']);

    expect(outDeclarations(fragment).filter((line) => line.includes('layout'))).toEqual([
      'layout(location = 0) out vec4 fragColor;',
      'layout(location = 2) out vec2 fragVelocity;',
    ]);
    expect(linkLog(vertex, fragment)).toBe('');
  });

  it('leaves a template without the output slots as it is, whatever the bits declare and the locations name', () => {
    const { fragment } = compileGlslSource({
      bits: [{ name: 'testGlOutputsVelocityDeclared', outputs: { velocity: 'vec2<f32>' } }],
      template: {
        bindGroups: [],
        gl: {
          vertex: '#version 300 es\n{{header}}\nvoid main() {}',
          fragment: '#version 300 es\n{{header}}\nout vec4 fragColor;\nvoid main() { fragColor = vec4(1.0); }',
        },
      },
      useLocations: false,
      outputLocations: ['missing'],
    });

    expect(fragment).not.toContain('struct Outputs');
    expect(outDeclarations(fragment)).toEqual(['out vec4 fragColor;']);
  });

  it('links with an output given a location and with it left out, and with integer outputs', () => {
    const idBit: ShaderBit = {
      name: 'testGlOutputsId',
      outputs: { id: 'u32', cell: 'vec2<i32>', depth: 'f32' },
      gl: {
        fragment: { end: 'outputs.id = 7u;\noutputs.cell = ivec2(gl_FragCoord.xy);\noutputs.depth = gl_FragCoord.z;' },
      },
    };

    for (const outputs of [['color'], ['color', 'velocity'], ['velocity', 'color'], ['color', 'id', 'cell', 'depth']]) {
      const { vertex, fragment } = compile([colorBit, velocityBit, idBit], outputs);

      expect(linkLog(vertex, fragment), outputs.join(',')).toBe('');
    }
  });
});
