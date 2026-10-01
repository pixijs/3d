import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { pbrMaterialBit } from '~/materials/pbr/bits/pbrMaterialBit';

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

describe('pbrMaterialBit derives the dielectric F0 from the IOR in pbrParams.w (KHR_materials_ior)', () => {
  describe('WGSL', () => {
    const out = compileWgslSource({ bits: [pbrMaterialBit], template: wgslTemplate });
    const src = out.fragment.source;

    it('derives fresnelF0 from material.pbrParams.w (IOR)', () => {
      expect(src).toContain('material.pbrParams.w');
      expect(src).toMatch(/fresnelF0\s*=\s*vec3<f32>\(iorRatio\s*\*\s*iorRatio\)/);
    });

    it('does not initialize fresnelF0 to a fixed 0.04, the F0 of IOR 1.5', () => {
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

    it('does not initialize fresnelF0 to a fixed 0.04, the F0 of IOR 1.5', () => {
      expect(src).not.toMatch(/vec3\s+fresnelF0\s*=\s*vec3\(0\.04\)/);
    });

    it('uses r*r rather than pow(r, 2.0) for the IOR ratio squared', () => {
      expect(src).not.toMatch(/pow\(\(ior\s*-\s*1\.0\)\s*\/\s*\(ior\s*\+\s*1\.0\),\s*2\.0\)/);
    });
  });
});
