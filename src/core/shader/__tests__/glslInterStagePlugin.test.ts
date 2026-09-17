import { describe, expect, it } from 'vitest';

import { glslInterStagePlugin } from '~/core/gl/codegen/glslInterStagePlugin';
import type { InterStageType, ShaderBit } from '~/core/shader/ShaderBit';
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

describe('glslInterStagePlugin', () => {
  // oxlint-disable-next-line jest/no-disabled-tests
  it.skip('should collect inter-stage variables excluding built-ins', () => {
    const context = createMockContext([
      { name: 'bit1', interStage: { vPosition: 'vec3<f32>', position: 'vec4<f32>' } as Record<string, InterStageType> },
      { name: 'bit2', interStage: { vColor: 'vec4<f32>', vMaterialIndex: 'u32' } },
    ]);

    glslInterStagePlugin.collectData!(context);

    expect(context.data.interStage).toEqual({
      vPosition: 'vec3<f32>',
      vColor: 'vec4<f32>',
      vMaterialIndex: 'u32',
    });
    // builtin 'position' filtered out
    expect(context.data.interStage!.position).toBeUndefined();
  });

  // oxlint-disable-next-line jest/no-disabled-tests
  it.skip('should emit out variables for vertex shader', () => {
    const context = createMockContext([], 'vertex');
    context.data.interStage = {
      vPosition: 'vec3<f32>',
      vMaterialIndex: 'u32',
    } as Record<string, InterStageType>;

    const result = glslInterStagePlugin.injectCode!(context);

    expect(result.header).toContain('out vec3 vPosition;');
    expect(result.header).toContain('flat out uint vMaterialIndex;');
  });

  // oxlint-disable-next-line jest/no-disabled-tests
  it.skip('should emit in variables for fragment shader', () => {
    const context = createMockContext([], 'fragment');
    context.data.interStage = {
      vPosition: 'vec3<f32>',
      vMaterialIndex: 'u32',
    } as Record<string, InterStageType>;

    const result = glslInterStagePlugin.injectCode!(context);

    expect(result.header).toContain('in vec3 vPosition;');
    expect(result.header).toContain('flat in uint vMaterialIndex;');
  });
});
