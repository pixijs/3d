import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { normalMappingBit } from '~/core/shader/bits/normalMappingBit';
import { tangentNormalMappingBit } from '~/core/shader/bits/tangentNormalMappingBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { pbrMaterialBit } from '~/materials/pbr/bits/pbrMaterialBit';

describe("normalScale scales the sampled normal's xy only, as glTF normalTextureInfo.scale defines, on both backends", () => {
  const wgslTpl: ShaderBitTemplate = { bindGroups: [], gpu: '{{header}}\n{{fragmentMaterial}}' };
  const glslTpl: ShaderBitTemplate = {
    bindGroups: [],
    gl: { vertex: '{{header}}\nvoid main() {}', fragment: '{{header}}\nvoid main() { {{material}} }' },
  };

  it('normalMappingBit, chosen per mesh, applies normalScale but leaves declaring it to the material bit', () => {
    expect(normalMappingBit.bindings).toBeUndefined();

    const out = compileWgslSource({ bits: [pbrMaterialBit, normalMappingBit], template: wgslTpl });
    expect(out.structs.Material).toMatchObject({ normalScale: 'f32' });
    expect(out.fragment.source).toContain('tangentNormal.xy * material.normalScale');
  });

  it('normalMappingBit applies material.normalScale to xy (GLSL)', () => {
    const out = compileGlslSource({ bits: [normalMappingBit], template: glslTpl });
    expect(out.fragment).toContain('tangentNormal.xy *= material.normalScale');
  });

  it('tangentNormalMappingBit, chosen per mesh, applies normalScale but leaves declaring it to the material bit', () => {
    expect(tangentNormalMappingBit.bindings).toBeUndefined();

    const out = compileWgslSource({ bits: [pbrMaterialBit, tangentNormalMappingBit], template: wgslTpl });
    expect(out.structs.Material).toMatchObject({ normalScale: 'f32' });
    expect(out.fragment.source).toContain('tangentNormal.xy * material.normalScale');
  });

  it('tangentNormalMappingBit applies material.normalScale to xy (GLSL)', () => {
    const out = compileGlslSource({ bits: [tangentNormalMappingBit], template: glslTpl });
    expect(out.fragment).toContain('tangentNormal.xy *= material.normalScale');
  });
});
