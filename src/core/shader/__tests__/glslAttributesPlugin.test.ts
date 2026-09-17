import { describe, expect, it } from 'vitest';

import { glslAttributesPlugin } from '~/core/gl/codegen/glslAttributesPlugin';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderCompilerContext } from '~/core/shader/ShaderCompilerPlugin';

function createMockContext(bits: ShaderBit[], stage?: 'vertex' | 'fragment'): ShaderCompilerContext {
  return {
    bits,
    template: { bindGroups: [] },
    templateString: '',
    data: {},
    stage,
  };
}

describe('glslAttributesPlugin', () => {
  // oxlint-disable-next-line jest/no-disabled-tests
  it.skip('should collect attributes into context.data', () => {
    const context = createMockContext(
      [
        { name: 'bit1', attributes: { aPosition: 'float32x3' } },
        { name: 'bit2', attributes: { aUV: 'float32x2' } },
      ],
      'vertex',
    );

    glslAttributesPlugin.collectData!(context);

    expect(context.data.attributes).toEqual({
      aPosition: 'float32x3',
      aUV: 'float32x2',
    });
  });

  // oxlint-disable-next-line jest/no-disabled-tests
  it.skip('should emit layout qualifiers for vertex shader', () => {
    const context = createMockContext([], 'vertex');
    context.data.attributes = {
      aPosition: 'float32x3',
      aUV: 'float32x2',
    };

    const result = glslAttributesPlugin.injectCode!(context);

    expect(result.header).toContain('layout(location = 0) in vec3 aPosition;');
    expect(result.header).toContain('layout(location = 1) in vec2 aUV;');
  });

  // oxlint-disable-next-line jest/no-disabled-tests
  it.skip('should not emit attributes for fragment shader', () => {
    const context = createMockContext([], 'fragment');
    context.data.attributes = {
      aPosition: 'float32x3',
    };

    const result = glslAttributesPlugin.injectCode!(context);

    expect(result.header).not.toContain('layout(location = 0) in vec3 aPosition;');
  });
});
