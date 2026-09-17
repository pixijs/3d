import { describe, expect, it } from 'vitest';

import { glslOverridesPlugin } from '~/core/gl/codegen/glslOverridesPlugin';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderCompilerContext } from '~/core/shader/ShaderCompilerPlugin';

function createMockContext(bits: ShaderBit[], overrides?: Record<string, number>): ShaderCompilerContext {
  return {
    bits,
    template: { bindGroups: [] },
    templateString: '',
    data: {},
    glslOptions: overrides ? { overrides } : undefined,
  };
}

describe('glslOverridesPlugin', () => {
  it('should normalize and collect overrides into context.data', () => {
    const context = createMockContext([
      { name: 'bit1', overrideDefs: { HAS_UVS: { type: 'u32', required: true } } },
      { name: 'bit2', overrideDefs: { MAX_LIGHTS: { type: 'u32', default: 10 } } },
    ]);

    glslOverridesPlugin.collectData!(context);

    expect(context.data.overrides).toEqual({
      HAS_UVS: { type: 'u32', required: true },
      MAX_LIGHTS: { type: 'u32', default: 10, required: false },
    });
  });

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
    // f32 default of 1 must round-trip as `1.0` so GLSL parses it as a float literal.
    expect(result.header).toContain('#define BASE_INT 1.0');
    expect(result.header).toContain('#define INT_VAL -5');
  });

  it('should prefer descriptor-supplied values over bit defaults', () => {
    const context = createMockContext(
      [{ name: 'bit', overrideDefs: { OUTLINE_WIDTH: { type: 'f32', default: 0.03 } } }],
      { OUTLINE_WIDTH: 0.1 },
    );

    glslOverridesPlugin.collectData!(context);
    const result = glslOverridesPlugin.injectCode!(context);

    expect(result.header).toContain('#define OUTLINE_WIDTH 0.1');
    expect(result.header).not.toContain('0.03');
  });

  it('should throw when a required override has no value supplied', () => {
    const context = createMockContext([{ name: 'bit', overrideDefs: { HAS_UVS: { type: 'u32', required: true } } }]);

    glslOverridesPlugin.collectData!(context);

    expect(() => glslOverridesPlugin.injectCode!(context)).toThrow(/HAS_UVS/);
  });
});
