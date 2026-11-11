import { describe, expect, it } from 'vitest';

import { glslOverridesPlugin } from '~/core/gl/codegen/glslOverridesPlugin';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderCompilerContext } from '~/core/shader/ShaderCompilerPlugin';

function createMockContext(bits: ShaderBit[]): ShaderCompilerContext {
  return {
    bits,
    template: { bindGroups: [] },
    templateString: '',
    data: {},
    outputLocations: ['color'],
  };
}

describe('glslOverridesPlugin', () => {
  it('should emit GLSL #defines with the correct literal shape per type', () => {
    const context = createMockContext([]);
    context.data.overrides = {
      MAX_LIGHTS: { type: 'u32', default: 10, required: false },
      BASE_ALPHA: { type: 'f32', default: 0.5, required: false },
      BASE_INT: { type: 'f32', default: 1, required: false },
      INT_VAL: { type: 'i32', default: -5, required: false },
    } as any;

    const result = glslOverridesPlugin.injectCode!(context);

    expect(result.header).toContain('#define MAX_LIGHTS 10');
    expect(result.header).toContain('#define BASE_ALPHA 0.5');
    expect(result.header, 'an integral f32 keeps a decimal point, so GLSL reads a float').toContain(
      '#define BASE_INT 1.0',
    );
    expect(result.header).toContain('#define INT_VAL -5');
  });

  it('should throw when a required override has no value supplied', () => {
    const context = createMockContext([{ name: 'bit', overrideDefs: { HAS_UVS: { type: 'u32', required: true } } }]);

    glslOverridesPlugin.collectData!(context);

    expect(() => glslOverridesPlugin.injectCode!(context)).toThrow(/HAS_UVS/);
  });
});
