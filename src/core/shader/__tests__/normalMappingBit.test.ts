import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { normalMappingBit } from '~/core/shader/bits/normalMappingBit';
import { tangentNormalMappingBit } from '~/core/shader/bits/tangentNormalMappingBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { clearcoatNormalMapBit } from '~/materials/pbr/bits/clearcoatBit';
import { pbrMaterialBit } from '~/materials/pbr/bits/pbrMaterialBit';

/**
 * Regression tests for the WGSL `dpdy` window-Y convention fix.
 *
 * WGSL's window-Y points DOWN (framebuffer convention) while GLSL's window-Y
 * points UP (legacy OpenGL). So `dpdy(p) == -dFdy(p)` for the same fragment.
 *
 * The derivative-based TBN math in `normalMappingBit.calculateTBN` and
 * `clearcoatBit.calculateClearcoatTBN` builds both the tangent and the
 * bitangent from terms that all flip together with `dp2 / duv2`. So an
 * un-compensated WGSL implementation negates the entire in-plane perturbation
 * — convex bumps shade like concave dents and vice versa, but only on
 * WebGPU. WebGL renders correctly because GLSL is the original convention
 * the math was authored against.
 *
 * The fix is to negate `dpdy()` in the WGSL bodies so the WGSL TBN matches
 * the GLSL TBN bit-for-bit. These tests pin that minus sign so a future
 * "let me clean up these signs" refactor can't silently re-invert WebGPU
 * normal mapping.
 */

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

describe('normalMappingBit calculateTBN — window-Y convention parity between WGSL and GLSL', () => {
  it('WGSL negates dpdy() so the result matches GLSL dFdy()', () => {
    const out = compileWgslSource({ bits: [normalMappingBit], template: wgslTemplate });
    const src = out.fragment.source;

    expect(src).toContain('let dp2 = -dpdy(position);');
    expect(src).toContain('let duv2 = -dpdy(texCoord);');

    // Negative test: a naked dpdy(...) on either of those lines (without
    // the leading minus) would re-introduce the bug. We don't want to ban
    // dpdy() outright because dpdx() is fine and an unrelated bit might
    // legitimately use dpdy().
    expect(src).not.toMatch(/let dp2 = dpdy\(position\)/);
    expect(src).not.toMatch(/let duv2 = dpdy\(texCoord\)/);
  });

  it('GLSL keeps dFdy() un-negated (its convention is the reference; double-negating would re-invert)', () => {
    const out = compileGlslSource({ bits: [normalMappingBit], template: glslTemplate });
    const src = out.fragment;

    expect(src).toContain('vec3 dp2 = dFdy(position);');
    expect(src).toContain('vec2 duv2 = dFdy(texCoord);');
    expect(src).not.toMatch(/vec3 dp2 = -dFdy\(position\)/);
    expect(src).not.toMatch(/vec2 duv2 = -dFdy\(texCoord\)/);
  });
});

describe('normalScale — bump-strength multiplier reaches both backends', () => {
  // The xy-only multiply is load-bearing: scaling z would tilt the normal
  // toward / away from the surface and break the renormalize. glTF
  // normalTextureInfo.scale is defined as a 2D xy multiplier.
  const wgslTpl: ShaderBitTemplate = { bindGroups: [], gpu: '{{header}}\n{{fragmentMaterial}}' };
  const glslTpl: ShaderBitTemplate = {
    bindGroups: [],
    gl: { vertex: '{{header}}\nvoid main() {}', fragment: '{{header}}\nvoid main() { {{material}} }' },
  };

  it('normalMappingBit applies normalScale but declares no material fields — pbrMaterialBit owns the field', () => {
    // Normal-mapping bits are selected per-MESH (geometry tangents + texture);
    // per-mesh bits must not reshape the per-material struct, so the field
    // lives unconditionally in pbrMaterialBit.
    expect(normalMappingBit.bindings).toBeUndefined();

    const out = compileWgslSource({ bits: [pbrMaterialBit, normalMappingBit], template: wgslTpl });
    expect(out.structs.Material).toMatchObject({ normalScale: 'f32' });
    expect(out.fragment.source).toContain('tangentNormal.xy * material.normalScale');
  });

  it('normalMappingBit applies material.normalScale to xy (GLSL)', () => {
    const out = compileGlslSource({ bits: [normalMappingBit], template: glslTpl });
    expect(out.fragment).toContain('tangentNormal.xy *= material.normalScale');
  });

  it('tangentNormalMappingBit applies normalScale but declares no material fields — pbrMaterialBit owns the field', () => {
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

describe('clearcoatBit calculateClearcoatTBN — same window-Y fix on the lacquer path', () => {
  // The clearcoat TBN uses the same derivative math as normalMappingBit, so it
  // needs the same dpdy compensation. Without it, clearcoat normal maps would
  // invert on WebGPU (currently invisible because the default sample is a
  // flat normal, but any asset that ships a clearcoat normal texture would
  // hit it the moment it loaded).
  const wgslTemplateCC: ShaderBitTemplate = {
    bindGroups: [],
    gpu: '{{header}}\nfn use_cc_tbn() -> mat3x3<f32> { return calculateClearcoatTBN(vec3<f32>(0.0), vec3<f32>(0.0), vec2<f32>(0.0)); }',
  };

  it('WGSL negates dpdy() inside calculateClearcoatTBN', () => {
    const out = compileWgslSource({ bits: [clearcoatNormalMapBit], template: wgslTemplateCC });
    const src = out.fragment.source;

    // Scope the assertion to the clearcoat helper so a future addition of an
    // unrelated dpdy() call elsewhere in the bit can't accidentally satisfy it.
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
