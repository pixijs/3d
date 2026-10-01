import { describe, expect, it } from 'vitest';

import { wgslOverridesPlugin } from '~/core/gpu/codegen/wgslOverridesPlugin';
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

describe('wgslOverridesPlugin', () => {
  it('should emit WGSL overrides correctly', () => {
    const context = createMockContext([]);
    context.data.overrides = {
      HAS_UVS: { type: 'u32', required: true },
      MAX_LIGHTS: { type: 'u32', default: 10, required: false },
      BASE_ALPHA: { type: 'f32', default: 0.5, required: false },
      INT_VAL: { type: 'i32', default: -5, required: false },
    } as any;

    const result = wgslOverridesPlugin.injectCode!(context);

    expect(result.header).toContain('override HAS_UVS: u32;');
    expect(result.header).toContain('override MAX_LIGHTS: u32 = 10u;');
    expect(result.header).toContain('override BASE_ALPHA: f32 = 0.5;');
    expect(result.header).toContain('override INT_VAL: i32 = -5;');
  });
});
