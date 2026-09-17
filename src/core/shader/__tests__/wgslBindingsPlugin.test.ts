import { describe, expect, it } from 'vitest';

import { wgslBindingsPlugin } from '~/core/gpu/codegen/wgslBindingsPlugin';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderCompilerContext } from '~/core/shader/ShaderCompilerPlugin';

function createMockContext(bits: ShaderBit[]): ShaderCompilerContext {
  return {
    bits,
    template: { bindGroups: ['global', 'material', 'local'] },
    templateString: '',
    data: {},
  };
}

describe('wgslBindingsPlugin', () => {
  // oxlint-disable-next-line jest/no-disabled-tests
  it.skip('should extract material properties into a group struct', () => {
    const context = createMockContext([
      {
        name: 'test',
        bindings: { material: { baseColor: 'vec4<f32>' } },
      },
    ]);

    wgslBindingsPlugin.collectData!(context);

    expect(context.data.structs!.Material.baseColor).toBe('vec4<f32>');
    expect(context.data.bindings!.bindGroups['material'].bindAsUniform).toBe(false);
  });

  it('should emit uniform bind groups correctly', () => {
    const context = createMockContext([]);
    context.data.bindings = {
      structs: { Global: { uTime: 'f32' } },
      bindGroups: {
        global: {
          groupIndex: 0,
          bindingIndex: 0,
          bindAsUniform: true,
          resources: {},
          storages: {},
        },
      },
      template: { bindGroups: ['global'] },
    };

    const result = wgslBindingsPlugin.injectCode!(context);

    expect(result.header).toContain('@group(0) @binding(0) var<uniform> global: Global;');
  });

  // oxlint-disable-next-line jest/no-disabled-tests
  it.skip('should build a struct from multiple bits and allow storage reference', () => {
    const bits: ShaderBit[] = [
      { name: 'bitA', bindings: { material: { baseColor: 'vec4<f32>' } } },
      { name: 'bitB', bindings: { material: { baseColor: 'vec4<f32>', roughness: 'f32' } } },
      { name: 'globalBitGpu', bindings: { global: { uMaterialStorage: 'storage<Material>' } } },
    ];

    const context = createMockContext(bits);
    wgslBindingsPlugin.collectData!(context);

    expect(context.data.structs!.Material).toEqual({
      baseColor: 'vec4<f32>',
      roughness: 'f32',
    });

    expect(context.data.bindings!.bindGroups['material'].bindAsUniform).toBe(false);
    expect(context.data.bindings!.bindGroups['global'].storages['uMaterialStorage']).toBe('Material');

    const result = wgslBindingsPlugin.injectCode!(context);

    expect(result.header).toContain('struct Material {');
    expect(result.header).toContain('baseColor: vec4<f32>,');
    expect(result.header).toContain('roughness: f32,');
    expect(result.header).toContain('var<storage, read> uMaterialStorage: array<Material>;');
    expect(result.header).not.toMatch(/@group.*@binding.*material/);
  });
});
