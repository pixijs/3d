import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';

const plainTemplate: ShaderBitTemplate = {
  bindGroups: ['global', 'camera'],
  gpu: '{{header}}',
  gl: {
    vertex: '#version 300 es\n{{header}}\nvoid main() {}',
    fragment: '#version 300 es\n{{header}}\nvoid main() {}',
  },
};

const blockTemplate: ShaderBitTemplate = { ...plainTemplate, bindGroups: [{ name: 'global', ubo: true }, 'camera'] };

const fields: ShaderBit = {
  name: 'probeFields',
  bindings: {
    global: { uProbeRows: 'array<vec4<f32>, 8>', uProbeScale: 'f32', uProbeMap: 'texture_2d<f32>' },
    camera: { uProbeView: 'mat4x4<f32>' },
  },
};

describe('a uniform<Struct> binding', () => {
  const rows: ShaderBit = {
    name: 'probeRows',
    structs: { ProbeRow: { uProbeColor: 'vec4<f32>', uProbeSpin: 'mat2x2<f32>', uProbeGain: 'f32' } },
    bindings: { global: { probeRow: 'uniform<ProbeRow>' } },
  };

  it("is a std140 block named after the binding with the instance u<Name>, its members the struct's fields in struct order, in both stages", () => {
    const { vertex, fragment, groupMap } = compileGlslSource({
      bits: [fields, rows],
      template: blockTemplate,
      useLocations: false,
    });

    for (const source of [vertex, fragment]) {
      expect(source).toContain(
        'layout(std140) uniform probeRow {\n  vec4 uProbeColor;\n  vec2 uProbeSpin_0;\n  vec2 uProbeSpin_1;\n  float uProbeGain;\n} uProbeRow;',
      );
      expect(source, 'the struct is declared for the shader to fill as well').toContain('struct ProbeRow {');
    }
    expect(groupMap[0], 'it takes a binding after the textures').toEqual({
      0: 'global',
      1: 'uProbeMap',
      2: 'probeRow',
    });
  });
});

describe("a uniform<Struct> binding the std140 block can't hold", () => {
  const batchTemplate: ShaderBitTemplate = {
    bindGroups: ['batch'],
    gpu: '{{header}}',
    gl: {
      vertex: '#version 300 es\n{{header}}\nvoid main() {}',
      fragment: '#version 300 es\n{{header}}\nvoid main() {}',
    },
  };
  const compile = (bit: ShaderBit) => compileGlslSource({ bits: [bit], template: batchTemplate, useLocations: false });

  it('refuses a member std140 lays out unlike WGSL', () => {
    const bit: ShaderBit = {
      name: 'probeWide',
      structs: { Wide: { rows: 'mat3x2<f32>' } },
      bindings: { batch: { wide: 'uniform<Wide>' } },
    };

    expect(() => compile(bit)).toThrow(/"rows" of uniform block "wide" is "mat3x2<f32>"/);
  });

  it('refuses a struct no bit declares fields for', () => {
    const bit: ShaderBit = { name: 'probeLost', bindings: { batch: { lost: 'uniform<Lost>' } } };

    expect(() => compile(bit)).toThrow(/"lost" is "uniform<Lost>", but no bit declares fields for a "Lost" struct/);
  });
});
