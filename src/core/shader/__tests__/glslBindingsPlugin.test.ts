import { describe, expect, it } from 'vitest';

import { glslBindingsPlugin } from '~/core/gl/codegen/glslBindingsPlugin';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderCompilerContext } from '~/core/shader/ShaderCompilerPlugin';

function createMockContext(
  bits: ShaderBit[],
  templateBindGroups: string[] = ['global', 'material', 'local'],
): ShaderCompilerContext {
  return {
    bits,
    template: { bindGroups: templateBindGroups },
    templateString: '',
    data: {},
    stage: 'fragment',
  };
}

describe('glslBindingsPlugin', () => {
  it('should extract material properties into a group struct', () => {
    const context = createMockContext([
      {
        name: 'test',
        bindings: { material: { baseColor: 'vec4<f32>' } },
      },
    ]);

    glslBindingsPlugin.collectData!(context);

    expect(context.data.structs!.Material.baseColor).toBe('vec4<f32>');
  });

  it('should build a struct from multiple bits and not emit as uniform if not ubo', () => {
    const bits: ShaderBit[] = [
      { name: 'bitA', bindings: { material: { baseColor: 'vec4<f32>' } } },
      { name: 'bitB', bindings: { material: { baseColor: 'vec4<f32>', roughness: 'f32' } } },
    ];

    const context = createMockContext(bits, ['global']);

    glslBindingsPlugin.collectData!(context);

    expect(context.data.structs!.Material).toEqual({
      baseColor: 'vec4<f32>',
      roughness: 'f32',
    });

    const result = glslBindingsPlugin.injectCode!(context);

    expect(result.header).toContain('struct Material {');
    expect(result.header).toContain('vec4 baseColor;');
    expect(result.header).toContain('float roughness;');
    expect(result.header).not.toContain('uniform Material');
  });

  it('should emit flat uniforms correctly', () => {
    const context = createMockContext([]);
    context.data.bindings = {
      structs: { Global: { uTime: 'f32' } } as any,
      source: 'uniform float uTime;',
    } as any;

    const result = glslBindingsPlugin.injectCode!(context);

    expect(result.header).toContain('uniform float uTime;');
  });
});
