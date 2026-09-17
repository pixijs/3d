import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { pbrMaterialBit } from '~/materials/pbr/bits/pbrMaterialBit';

/**
 * Regression tests for the IOR-derived dielectric F0 term (KHR_materials_ior).
 *
 * Before these tests, `fresnelF0` was hardcoded to `0.04` — equivalent to a
 * fixed IOR of 1.5. The move to `pow((ior - 1) / (ior + 1), 2)` reading from
 * `pbrParams.w` is easy to regress with a "simplify this" refactor, so we
 * pin three things in the generated shader source:
 *
 *   1. `fresnelF0` is NOT initialized to a literal `0.04` (old behavior).
 *   2. `pbrParams.w` is read (the IOR source of truth on Material3D).
 *   3. The formula uses explicit multiplication, not `pow(x, 2.0)` — the
 *      codebase's convention for small integer powers (see SG Schlick).
 */

const wgslTemplate: ShaderBitTemplate = {
  bindGroups: [],
  gpu: '{{header}}\n{{fragmentMaterial}}',
};

const glslTemplate: ShaderBitTemplate = {
  bindGroups: [],
  gl: {
    vertex: '{{header}}\nvoid main() {}',
    fragment: '{{header}}\nvoid main() { {{material}} }',
  },
};

describe('pbrMaterialBit — dielectric F0 from IOR', () => {
  describe('WGSL', () => {
    const out = compileWgslSource({ bits: [pbrMaterialBit], template: wgslTemplate });
    const src = out.fragment.source;

    it('derives fresnelF0 from material.pbrParams.w (IOR)', () => {
      expect(src).toContain('material.pbrParams.w');
      expect(src).toMatch(/fresnelF0\s*=\s*vec3<f32>\(iorRatio\s*\*\s*iorRatio\)/);
    });

    it('does not initialize fresnelF0 with the old hardcoded 0.04 literal', () => {
      expect(src).not.toMatch(/fresnelF0:\s*vec3<f32>\s*=\s*vec3<f32>\(0\.04\)/);
    });

    it('uses r*r rather than pow(r, 2.0) for the IOR ratio squared', () => {
      expect(src).not.toMatch(/pow\(\(ior\s*-\s*1\.0\)\s*\/\s*\(ior\s*\+\s*1\.0\),\s*2\.0\)/);
    });
  });

  describe('GLSL', () => {
    const out = compileGlslSource({ bits: [pbrMaterialBit], template: glslTemplate });
    const src = out.fragment;

    it('derives fresnelF0 from material.pbrParams.w (IOR)', () => {
      expect(src).toContain('material.pbrParams.w');
      expect(src).toMatch(/fresnelF0\s*=\s*vec3\(iorRatio\s*\*\s*iorRatio\)/);
    });

    it('does not initialize fresnelF0 with the old hardcoded 0.04 literal', () => {
      expect(src).not.toMatch(/vec3\s+fresnelF0\s*=\s*vec3\(0\.04\)/);
    });

    it('uses r*r rather than pow(r, 2.0) for the IOR ratio squared', () => {
      expect(src).not.toMatch(/pow\(\(ior\s*-\s*1\.0\)\s*\/\s*\(ior\s*\+\s*1\.0\),\s*2\.0\)/);
    });
  });
});
