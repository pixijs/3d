import { Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { pbrMaterialBit } from '~/materials/pbr/bits/pbrMaterialBit';
import { specularBit } from '~/materials/pbr/bits/specularBit';
import { Material3D } from '~/materials/pbr/Material3D';
import { View3D } from '~/scene/View3D';

/**
 * Regression tests for KHR_materials_specular.
 *
 *   - `pbrMaterialBit` declares `var fresnelF0` (from IOR) and `var f90 = 1.0`
 *     as the spec-default baseline.
 *   - `specularBit` (conditional) overwrites both to apply `specularFactor` /
 *     `specularColorFactor` and their textures.
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

describe('specularBit — KHR_materials_specular', () => {
  describe('WGSL', () => {
    const out = compileWgslSource({ bits: [pbrMaterialBit, specularBit], template: wgslTemplate });
    const src = out.fragment.source;

    it('reads specularParams from the material struct', () => {
      expect(src).toContain('material.specularParams');
    });

    it('samples the packed specular texture', () => {
      expect(src).toContain('sampleSpecular');
    });

    it('applies gamma-2.2 sRGB decode to the specular colour texture (matches codebase convention)', () => {
      expect(src).toMatch(/pow\(specTexStraight,\s*vec3(?:<f32>)?\(2\.2\)\)/);
    });

    it('overwrites fresnelF0 and f90 (so IBL/lighting consume the modified values)', () => {
      // The whole point of the bit — must assign both. Using `mix` on both
      // pins the metal-preservation rule (metals stay on baseColor F0 / f90=1).
      expect(src).toMatch(/fresnelF0\s*=\s*mix\(dielectricF0,\s*albedo,\s*metallic\)/);
      expect(src).toMatch(/f90\s*=\s*mix\(specFactor,\s*1\.0,\s*metallic\)/);
    });

    it('clamps the dielectric F0 to <=1 per spec (min(iorF0 * specColor, 1))', () => {
      expect(src).toMatch(/min\(iorF0\s*\*\s*specColor,\s*vec3<f32>\(1\.0\)\)/);
    });
  });

  describe('GLSL', () => {
    const out = compileGlslSource({ bits: [pbrMaterialBit, specularBit], template: glslTemplate });
    const src = out.fragment;

    it('reads specularParams from the material struct', () => {
      expect(src).toContain('material.specularParams');
    });

    it('samples the packed specular texture', () => {
      expect(src).toContain('sampleSpecular');
    });

    it('applies gamma-2.2 sRGB decode to the specular colour texture', () => {
      expect(src).toMatch(/pow\(specTexStraight,\s*vec3(?:<f32>)?\(2\.2\)\)/);
    });

    it('overwrites fresnelF0 and f90 via mix() to preserve metal F0', () => {
      expect(src).toMatch(/fresnelF0\s*=\s*mix\(dielectricF0,\s*albedo,\s*metallic\)/);
      expect(src).toMatch(/f90\s*=\s*mix\(specFactor,\s*1\.0,\s*metallic\)/);
    });

    it('clamps the dielectric F0 to <=1 per spec', () => {
      expect(src).toMatch(/min\(iorF0\s*\*\s*specColor,\s*vec3\(1\.0\)\)/);
    });
  });
});

describe('Material3D descriptor — construction-time specularBit inclusion', () => {
  // Minimal view — these tests inspect material-side bit composition only,
  // so env state doesn't matter (defaults to envSourceDefaultBit on the view).
  const view = new View3D({ width: 1, height: 1 });

  it('does NOT include specularBit for a default material (no specular options supplied)', () => {
    const material = new Material3D({});
    const desc = material.getPrimaryDescriptor(view);
    expect(desc.bitsGpu).not.toContain(specularBit);
    expect(desc.bitsGl).not.toContain(specularBit);
  });

  it('includes specularBit when constructed with specularFactor (even 1.0)', () => {
    // Construction-time opt-in — the shader variant + texture slot are
    // reserved regardless of the factor's value, so runtime factor writes
    // never recompile. Matches clearcoatBit/sheenBit semantics.
    const material = new Material3D({ specular: { factor: 1.0 } });
    expect(material.getPrimaryDescriptor(view).bitsGpu).toContain(specularBit);
  });

  it('includes specularBit when constructed with specularColorFactor', () => {
    const material = new Material3D({ specular: { color: 0xffc77a } });
    expect(material.getPrimaryDescriptor(view).bitsGpu).toContain(specularBit);
  });

  it('includes specularBit when constructed with only a specularTexture', () => {
    const material = new Material3D({ specular: { texture: Texture.WHITE } });
    expect(material.getPrimaryDescriptor(view).bitsGpu).toContain(specularBit);
  });

  it('includes specularBit when constructed with only a specularColorTexture', () => {
    const material = new Material3D({ specular: { colorTexture: Texture.WHITE } });
    expect(material.getPrimaryDescriptor(view).bitsGpu).toContain(specularBit);
  });

  it('keeps specularBit in the descriptor across runtime specularFactor changes (no recompile)', () => {
    const material = new Material3D({ specular: { factor: 1.0 } });
    const descBefore = material.getPrimaryDescriptor(view);

    material.specular!.factor = 0.25;
    const descAfter = material.getPrimaryDescriptor(view);

    expect(descAfter).toBe(descBefore);
    expect(material.specular!.factor).toBe(0.25);
  });

  it('exposes no specular props when the material did not opt in at construction', () => {
    const material = new Material3D({});
    expect(material.specular).toBeUndefined();
  });
});

describe('pbrMaterialBit without specularBit — default f90 preserved', () => {
  it('declares f90 = 1.0 as the default so IBL/lighting math is unchanged', () => {
    const out = compileWgslSource({ bits: [pbrMaterialBit], template: wgslTemplate });
    const src = out.fragment.source;
    expect(src).toMatch(/var\s+f90\s*:\s*f32\s*=\s*1\.0/);
  });

  it('GLSL: declares float f90 = 1.0', () => {
    const out = compileGlslSource({ bits: [pbrMaterialBit], template: glslTemplate });
    const src = out.fragment;
    expect(src).toMatch(/float\s+f90\s*=\s*1\.0/);
  });
});
