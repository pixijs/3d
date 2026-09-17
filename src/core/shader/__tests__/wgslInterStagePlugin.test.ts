import { describe, expect, it } from 'vitest';

import { wgslInterStagePlugin } from '~/core/gpu/codegen/wgslInterStagePlugin';
import type { ShaderBit, InterStageType } from '~/core/shader/ShaderBit';
import type { ShaderCompilerContext } from '~/core/shader/ShaderCompilerPlugin';

function createMockContext(bits: ShaderBit[]): ShaderCompilerContext {
  return {
    bits,
    template: { bindGroups: [] },
    templateString: '',
    data: {},
  };
}

describe('wgslInterStagePlugin', () => {
  it('should collect inter-stage variables excluding built-ins', () => {
    const context = createMockContext([
      { name: 'bit1', interStage: { vPosition: 'vec3<f32>', position: 'vec4<f32>' } as Record<string, InterStageType> },
      { name: 'bit2', interStage: { vColor: 'vec4<f32>', vMaterialIndex: 'u32' } },
    ]);

    wgslInterStagePlugin.collectData!(context);

    expect(context.data.interStage).toEqual({
      vPosition: 'vec3<f32>',
      vColor: 'vec4<f32>',
      vMaterialIndex: 'u32',
    });
    // 'position' is filtered out because it is a builtin that the emitter adds automatically
    expect(context.data.interStage!.position).toBeUndefined();
  });

  it('should emit the VertexOutput and FragmentInput structs with correct flat interpolation', () => {
    const context = createMockContext([]);
    context.data.interStage = {
      vPosition: 'vec3<f32>',
      vMaterialIndex: 'u32', // Should get @interpolate(flat)
    } as Record<string, InterStageType>;

    const result = wgslInterStagePlugin.injectCode!(context);

    expect(result.header).toContain('struct VertexOutput {');
    expect(result.header).toContain('@builtin(position) position: vec4<f32>,');
    expect(result.header).toContain('@location(0) vPosition: vec3<f32>,');
    expect(result.header).toContain('@location(1) @interpolate(flat) vMaterialIndex: u32,');

    expect(result.header).toContain('struct FragmentInput {');
    expect(result.header).toContain('@builtin(position) position: vec4<f32>,');
    expect(result.header).toContain('@builtin(front_facing) frontFacing: bool,');
    expect(result.header).toContain('@location(0) vPosition: vec3<f32>,');
    expect(result.header).toContain('@location(1) @interpolate(flat) vMaterialIndex: u32,');
  });
});
