import { describe, expect, it } from 'vitest';

import { wgslAttributesPlugin } from '~/core/gpu/codegen/wgslAttributesPlugin';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderCompilerContext } from '~/core/shader/ShaderCompilerPlugin';

function createMockContext(bits: ShaderBit[]): ShaderCompilerContext {
  return {
    bits,
    template: { bindGroups: [] },
    templateString: '',
    data: {},
  };
}

describe('wgslAttributesPlugin', () => {
  it('should collect attributes from multiple bits into context.data', () => {
    const context = createMockContext([
      { name: 'bit1', attributes: { aPosition: 'float32x3' } },
      { name: 'bit2', attributes: { aNormal: 'float32x3', aUV: 'float32x2' } },
    ]);

    wgslAttributesPlugin.collectData!(context);

    expect(context.data.attributes).toEqual({
      aPosition: 'float32x3',
      aNormal: 'float32x3',
      aUV: 'float32x2',
    });
  });

  it('should emit the VertexInput struct from context.data', () => {
    const context = createMockContext([]);
    context.data.attributes = {
      aPosition: 'float32x3',
      aNormal: 'float32x3',
      aUV: 'float32x2',
    };

    const result = wgslAttributesPlugin.injectCode!(context);

    expect(result.header).toContain('struct VertexInput {');
    expect(result.header).toContain('@location(0) aPosition: vec3<f32>,');
    expect(result.header).toContain('@location(1) aNormal: vec3<f32>,');
    expect(result.header).toContain('@location(2) aUV: vec2<f32>,');
    expect(result.header).toContain('}');
  });
});
