import { Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { emissiveBit } from '~/core/shader/bits/emissiveBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { pbrMaterialBit } from '~/materials/pbr/bits/pbrMaterialBit';
import { Material3D } from '~/materials/pbr/Material3D';
import { View3D } from '~/scene/View3D';

/**
 * Regression tests for KHR_materials_emissive_strength and the emissive
 * extraction from pbrMaterialBit.
 *
 * The emissive path:
 *   - `pbrMaterialBit` declares `var emissive = vec3(0)` as the neutral default
 *   - `emissiveBit` (conditional) assigns `emissive = material.emissive *
 *     material.emissiveStrength` and applies the texture sample + gamma-2.2 sRGB decode
 *
 * We pin three things in the compiled source (both backends):
 *
 *   1. Both `material.emissive` and `material.emissiveStrength` are read.
 *   2. The product form `material.emissive * material.emissiveStrength` is
 *      present — guards against a "simplify this" refactor dropping the
 *      multiplier or re-baking it at load time.
 *   3. The emissive texture is gamma-2.2 sRGB decoded (`pow(emissiveTex, vec3(2.2))`).
 *   4. The `emissive` variable is *assigned*, not re-declared — ensures the
 *      bit reuses the pbrMaterialBit default instead of shadowing it.
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

describe('emissiveBit — KHR_materials_emissive_strength', () => {
  describe('WGSL', () => {
    const out = compileWgslSource({ bits: [pbrMaterialBit, emissiveBit], template: wgslTemplate });
    const src = out.fragment.source;

    it('reads both emissive and emissiveStrength from the material struct', () => {
      expect(src).toContain('material.emissive');
      expect(src).toContain('material.emissiveStrength');
    });

    it('multiplies emissive by emissiveStrength (pins the KHR_materials_emissive_strength multiplier)', () => {
      expect(src).toMatch(/emissive\s*=\s*material\.emissive\s*\*\s*material\.emissiveStrength/);
    });

    it('gamma-2.2 sRGB decodes the emissive texture', () => {
      expect(src).toMatch(/emissive\s*\*=\s*pow\(emissiveTex, vec3(?:<f32>)?\(2\.2\)\)/);
      expect(src).not.toMatch(/emissiveTex\s*\*\s*emissiveTex/);
    });

    it('assigns (does not redeclare) emissive — reuses pbrMaterialBit default', () => {
      expect(src).not.toMatch(/var\s+emissive\s*:\s*vec3<f32>\s*=\s*material\.emissive/);
    });
  });

  describe('GLSL', () => {
    const out = compileGlslSource({ bits: [pbrMaterialBit, emissiveBit], template: glslTemplate });
    const src = out.fragment;

    it('reads both emissive and emissiveStrength from the material struct', () => {
      expect(src).toContain('material.emissive');
      expect(src).toContain('material.emissiveStrength');
    });

    it('multiplies emissive by emissiveStrength (pins the KHR_materials_emissive_strength multiplier)', () => {
      expect(src).toMatch(/emissive\s*=\s*material\.emissive\s*\*\s*material\.emissiveStrength/);
    });

    it('gamma-2.2 sRGB decodes the emissive texture', () => {
      expect(src).toMatch(/emissive\s*\*=\s*pow\(emissiveTex, vec3(?:<f32>)?\(2\.2\)\)/);
      expect(src).not.toMatch(/emissiveTex\s*\*\s*emissiveTex/);
    });

    it('assigns (does not redeclare) emissive — reuses pbrMaterialBit default', () => {
      // emissiveBit declares a local vec3 emissiveTex for the texture sample, but
      // must not declare a new `emissive` (that would shadow pbrMaterialBit's default).
      expect(src).not.toMatch(/vec3\s+emissive\s*=\s*material\.emissive/);
    });
  });
});

describe('Material3D descriptor — construction-time emissiveBit inclusion', () => {
  // Minimal view — these tests inspect material-side bit composition only,
  // so env state doesn't matter (defaults to envSourceDefaultBit on the view).
  const view = new View3D({ width: 1, height: 1 });

  it('does NOT include emissiveBit for a default material (no emissive options supplied)', () => {
    const material = new Material3D({});
    const desc = material.getPrimaryDescriptor(view);
    expect(desc.bitsGpu).not.toContain(emissiveBit);
    expect(desc.bitsGl).not.toContain(emissiveBit);
  });

  it('includes emissiveBit when constructed with any emissive colour (even black)', () => {
    // Matches clearcoatBit/sheenBit semantics: opting in at construction
    // reserves the shader variant + texture slot; runtime colour changes
    // never recompile.
    const material = new Material3D({ emissive: { color: 0x000000 } });
    expect(material.getPrimaryDescriptor(view).bitsGpu).toContain(emissiveBit);
  });

  it('includes emissiveBit when constructed with only an emissiveTexture', () => {
    const material = new Material3D({ emissive: { texture: Texture.WHITE } });
    expect(material.getPrimaryDescriptor(view).bitsGpu).toContain(emissiveBit);
  });

  it('keeps emissiveBit in the descriptor across runtime colour changes (no recompile)', () => {
    const material = new Material3D({ emissive: { color: 0xff0000 } });
    const descBefore = material.getPrimaryDescriptor(view);

    material.emissive!.color = 0x000000;
    const descAfter = material.getPrimaryDescriptor(view);

    // Same descriptor object: colour changes only queue a row upload
    // (material.update()), never a shader-variant rebuild. Pins the "never
    // remove a feature once added" rule.
    expect(descAfter).toBe(descBefore);
    expect(descAfter.bitsGpu).toContain(emissiveBit);
  });

  it('does NOT rebuild the descriptor when emissiveStrength changes', () => {
    const material = new Material3D({ emissive: { color: 0xff0000, strength: 1 } });
    const descBefore = material.getPrimaryDescriptor(view);

    material.emissive!.strength = 10;
    const descAfter = material.getPrimaryDescriptor(view);

    expect(descAfter).toBe(descBefore);
    expect(material.emissive!.strength).toBe(10);
  });

  it('texture slot order is stable under transmission + dormant-but-allocated emissive', () => {
    // Regression: gating the bit on a non-black emissive colour left
    // `_textures[4]` holding emissive while the shader expected transmission
    // at that slot → mis-sample. Under construction-time gating the layout
    // stays pinned to the _textures order.
    const material = new Material3D({ emissive: { color: 0x000000 }, transmission: { factor: 0.5 } });
    const desc = material.getPrimaryDescriptor(view);
    expect(desc.bitsGpu).toContain(emissiveBit); // construction-time inclusion
    // Texture index is ordered by batch-texture order across the active bits:
    // pbrMaterialBit [bc, mr, oc, n] → emissiveBit [emissive] → transmissionBit [tx, th]
    // so emissive lands at index 4, transmission at 5, thickness at 6.
    expect(material.transmission!.texture).toBe(material['_textures'][5]);
    expect(material.transmission!.thicknessTexture).toBe(material['_textures'][6]);
  });
});

describe('pbrMaterialBit without emissiveBit — dormant emissive', () => {
  describe('WGSL', () => {
    const out = compileWgslSource({ bits: [pbrMaterialBit], template: wgslTemplate });
    const src = out.fragment.source;

    it('keeps the vec3(0) default so pbrLightingBit can still read emissive', () => {
      expect(src).toMatch(/var\s+emissive\s*:\s*vec3<f32>\s*=\s*vec3<f32>\(0\.0\)/);
    });

    it('does not read material.emissive or material.emissiveStrength', () => {
      expect(src).not.toContain('material.emissive');
      expect(src).not.toContain('material.emissiveStrength');
    });

    it('does not sample the emissive texture', () => {
      expect(src).not.toContain('sampleEmissive');
    });
  });

  describe('GLSL', () => {
    const out = compileGlslSource({ bits: [pbrMaterialBit], template: glslTemplate });
    const src = out.fragment;

    it('keeps the vec3(0) default so pbrLightingBit can still read emissive', () => {
      expect(src).toMatch(/vec3\s+emissive\s*=\s*vec3\(0\.0\)/);
    });

    it('does not read material.emissive or material.emissiveStrength', () => {
      expect(src).not.toContain('material.emissive');
      expect(src).not.toContain('material.emissiveStrength');
    });

    it('does not sample the emissive texture', () => {
      expect(src).not.toContain('sampleEmissive');
    });
  });
});
