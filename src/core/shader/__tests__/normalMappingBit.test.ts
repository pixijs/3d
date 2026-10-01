import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { normalMappingBit } from '~/core/shader/bits/normalMappingBit';
import { tangentNormalMappingBit } from '~/core/shader/bits/tangentNormalMappingBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { clearcoatNormalMapBit } from '~/materials/pbr/bits/clearcoatBit';
import { pbrMaterialBit } from '~/materials/pbr/bits/pbrMaterialBit';

const wgslTemplate: ShaderBitTemplate = {
  bindGroups: [],
  gpu: '{{header}}\nfn use_tbn() -> mat3x3<f32> { return calculateTBN(vec3<f32>(0.0), vec3<f32>(0.0), vec2<f32>(0.0)); }',
};

const glslTemplate: ShaderBitTemplate = {
  bindGroups: [],
  gl: {
    vertex: '{{header}}\nvoid main() {}',
    fragment: '{{header}}\nvoid main() {}',
  },
};

describe("normalMappingBit calculateTBN: WGSL window Y points down where GLSL's points up", () => {
  it('WGSL negates dpdy() so the result matches GLSL dFdy(); without it, WebGPU bumps shade as dents', () => {
    const out = compileWgslSource({ bits: [normalMappingBit], template: wgslTemplate });
    const src = out.fragment.source;

    expect(src).toContain('let dp2 = -dpdy(position);');
    expect(src).toContain('let duv2 = -dpdy(texCoord);');

    expect(src).not.toMatch(/let dp2 = dpdy\(position\)/);
    expect(src).not.toMatch(/let duv2 = dpdy\(texCoord\)/);
  });

  it('GLSL keeps dFdy() un-negated, since its convention is the one the math was written for', () => {
    const out = compileGlslSource({ bits: [normalMappingBit], template: glslTemplate });
    const src = out.fragment;

    expect(src).toContain('vec3 dp2 = dFdy(position);');
    expect(src).toContain('vec2 duv2 = dFdy(texCoord);');
    expect(src).not.toMatch(/vec3 dp2 = -dFdy\(position\)/);
    expect(src).not.toMatch(/vec2 duv2 = -dFdy\(texCoord\)/);
  });
});

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

describe('clearcoatBit calculateClearcoatTBN: the same derivative TBN, with the same dpdy negation', () => {
  const wgslTemplateCC: ShaderBitTemplate = {
    bindGroups: [],
    gpu: '{{header}}\nfn use_cc_tbn() -> mat3x3<f32> { return calculateClearcoatTBN(vec3<f32>(0.0), vec3<f32>(0.0), vec2<f32>(0.0)); }',
  };

  it('WGSL negates dpdy() inside calculateClearcoatTBN itself, not elsewhere in the bit', () => {
    const out = compileWgslSource({ bits: [clearcoatNormalMapBit], template: wgslTemplateCC });
    const src = out.fragment.source;

    const fnStart = src.indexOf('fn calculateClearcoatTBN(');
    expect(fnStart).toBeGreaterThanOrEqual(0);
    const fnEnd = src.indexOf('\n}\n', fnStart);
    const fnBody = src.slice(fnStart, fnEnd);

    expect(fnBody).toContain('let dp2 = -dpdy(position);');
    expect(fnBody).toContain('let duv2 = -dpdy(texCoord);');
    expect(fnBody).not.toMatch(/let dp2 = dpdy\(position\)/);
    expect(fnBody).not.toMatch(/let duv2 = dpdy\(texCoord\)/);
  });
});
