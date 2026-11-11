import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { pbrMaterialBit } from '~/materials/pbr/bits/pbrMaterialBit';
import { specularBit } from '~/materials/pbr/bits/specularBit';
import { Material3D } from '~/materials/pbr/Material3D';
import { View3D } from '~/scene/View3D';

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

describe('specularBit overwrites the fresnelF0 and f90 pbrMaterialBit derives from IOR (KHR_materials_specular)', () => {
  describe('WGSL', () => {
    const out = compileWgslSource({ bits: [pbrMaterialBit, specularBit], template: wgslTemplate });
    const src = out.fragment.source;

    it('sRGB-decodes the specular colour texture with a 2.2 gamma', () => {
      expect(src).toMatch(/pow\(specTexStraight,\s*vec3(?:<f32>)?\(2\.2\)\)/);
    });
  });

  describe('GLSL', () => {
    const out = compileGlslSource({ bits: [pbrMaterialBit, specularBit], template: glslTemplate });
    const src = out.fragment;

    it('sRGB-decodes the specular colour texture with a 2.2 gamma', () => {
      expect(src).toMatch(/pow\(specTexStraight,\s*vec3(?:<f32>)?\(2\.2\)\)/);
    });
  });
});

describe('Material3D adds specularBit at construction', () => {
  const view = new View3D({ width: 1, height: 1 });

  it('includes specularBit when constructed with any factor, even 1.0, so factor changes never recompile', () => {
    const material = new Material3D({ specular: { factor: 1.0 } });
    expect(material.getPrimaryDescriptor(view).bitsGpu).toContain(specularBit);
  });

  it('exposes no specular props when the material did not opt in at construction', () => {
    const material = new Material3D({});
    expect(material.specular).toBeUndefined();
  });
});
