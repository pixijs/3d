import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { pbrMaterialBit } from '~/materials/pbr/bits/pbrMaterialBit';

const glslTemplate: ShaderBitTemplate = {
  bindGroups: [],
  gl: {
    vertex: '{{header}}\nvoid main() {}',
    fragment: '{{header}}\nvoid main() { {{material}} }',
  },
};

describe('pbrMaterialBit derives the dielectric F0 from the IOR in pbrParams.w (KHR_materials_ior)', () => {
  describe('GLSL', () => {
    const out = compileGlslSource({ bits: [pbrMaterialBit], template: glslTemplate });
    const src = out.fragment;

    it('derives fresnelF0 from material.pbrParams.w (IOR)', () => {
      expect(src).toContain('material.pbrParams.w');
      expect(src).toMatch(/fresnelF0\s*=\s*vec3\(iorRatio\s*\*\s*iorRatio\)/);
    });
  });
});
