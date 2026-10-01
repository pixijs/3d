import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { emissiveBit } from '~/core/shader/bits/emissiveBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { pbrMaterialBit } from '~/materials/pbr/bits/pbrMaterialBit';
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

describe('emissiveBit assigns the emissive that pbrMaterialBit zeroes, with KHR_materials_emissive_strength', () => {
  describe('WGSL', () => {
    const out = compileWgslSource({ bits: [pbrMaterialBit, emissiveBit], template: wgslTemplate });
    const src = out.fragment.source;

    it('reads both emissive and emissiveStrength from the material struct', () => {
      expect(src).toContain('material.emissive');
      expect(src).toContain('material.emissiveStrength');
    });

    it('multiplies emissive by emissiveStrength in the shader', () => {
      expect(src).toMatch(/emissive\s*=\s*material\.emissive\s*\*\s*material\.emissiveStrength/);
    });

    it('gamma-2.2 sRGB decodes the emissive texture', () => {
      expect(src).toMatch(/emissive\s*\*=\s*pow\(emissiveTex, vec3(?:<f32>)?\(2\.2\)\)/);
      expect(src).not.toMatch(/emissiveTex\s*\*\s*emissiveTex/);
    });
  });

  describe('GLSL', () => {
    const out = compileGlslSource({ bits: [pbrMaterialBit, emissiveBit], template: glslTemplate });
    const src = out.fragment;

    it('reads both emissive and emissiveStrength from the material struct', () => {
      expect(src).toContain('material.emissive');
      expect(src).toContain('material.emissiveStrength');
    });

    it('multiplies emissive by emissiveStrength in the shader', () => {
      expect(src).toMatch(/emissive\s*=\s*material\.emissive\s*\*\s*material\.emissiveStrength/);
    });

    it('gamma-2.2 sRGB decodes the emissive texture', () => {
      expect(src).toMatch(/emissive\s*\*=\s*pow\(emissiveTex, vec3(?:<f32>)?\(2\.2\)\)/);
      expect(src).not.toMatch(/emissiveTex\s*\*\s*emissiveTex/);
    });
  });
});

describe('Material3D adds emissiveBit at construction', () => {
  const view = new View3D({ width: 1, height: 1 });

  it('includes emissiveBit when constructed with any emissive colour, even black, so colour changes never recompile', () => {
    const material = new Material3D({ emissive: { color: 0x000000 } });
    expect(material.getPrimaryDescriptor(view).bitsGpu).toContain(emissiveBit);
  });

  it('keeps the same descriptor, emissiveBit included, when the colour changes at runtime', () => {
    const material = new Material3D({ emissive: { color: 0xff0000 } });
    const descBefore = material.getPrimaryDescriptor(view);

    material.emissive!.color = 0x000000;
    const descAfter = material.getPrimaryDescriptor(view);

    expect(descAfter).toBe(descBefore);
    expect(descAfter.bitsGpu).toContain(emissiveBit);
  });
});
