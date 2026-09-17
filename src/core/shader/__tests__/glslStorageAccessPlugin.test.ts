import { describe, expect, it } from 'vitest';

import { generateGlslStorageAccessor } from '~/core/gl/codegen/glslStorageAccessPlugin';

describe('generateGlslStorageAccessor', () => {
  it('should generate accessor for a single vec4 field', () => {
    const result = generateGlslStorageAccessor('Material', { baseColor: 'vec4<f32>' }, 6);

    expect(result).toContain('Material getMaterial(uint index)');
    expect(result).toContain('texelFetch(uMaterialStorage');
    expect(result).toContain('m.baseColor = t0;');
    expect(result).toContain('return m;');
  });

  it('should group vec3 + f32 into one texel fetch with correct swizzles', () => {
    const result = generateGlslStorageAccessor('Material', { emissive: 'vec3<f32>', alphaCutoff: 'f32' }, 6);

    expect(result).toContain('m.emissive = t0.xyz;');
    expect(result).toContain('m.alphaCutoff = t0.w;');
    // Only one texel fetch for both fields
    const fetchCount = (result.match(/texelFetch/g) || []).length;
    expect(fetchCount).toBe(1);
  });

  it('should handle full PBR struct with correct texel grouping', () => {
    const result = generateGlslStorageAccessor(
      'Material',
      {
        baseColor: 'vec4<f32>',
        emissive: 'vec3<f32>',
        alphaCutoff: 'f32',
        pbrParams: 'vec4<f32>',
        transmissionVolume: 'vec4<f32>',
        attenuationColorIrid: 'vec4<f32>',
        iridescenceThickness: 'f32',
      },
      6,
    );

    // 7 fields across 6 texels (emissive + alphaCutoff share texel 1)
    expect(result).toContain('m.baseColor = t0;');
    expect(result).toContain('m.emissive = t1.xyz;');
    expect(result).toContain('m.alphaCutoff = t1.w;');
    expect(result).toContain('m.pbrParams = t2;');
    expect(result).toContain('m.transmissionVolume = t3;');
    expect(result).toContain('m.attenuationColorIrid = t4;');
    expect(result).toContain('m.iridescenceThickness = t5.x;');

    const fetchCount = (result.match(/texelFetch/g) || []).length;
    expect(fetchCount).toBe(6);
  });

  it('should handle flat material struct (vec4 + f32)', () => {
    const result = generateGlslStorageAccessor(
      'Material',
      {
        baseColor: 'vec4<f32>',
        alphaCutoff: 'f32',
      },
      6,
    );

    expect(result).toContain('m.baseColor = t0;');
    expect(result).toContain('m.alphaCutoff = t1.x;');

    const fetchCount = (result.match(/texelFetch/g) || []).length;
    expect(fetchCount).toBe(2);
  });

  it('should use correct texture name based on struct name', () => {
    const result = generateGlslStorageAccessor('Light', { color: 'vec3<f32>' }, 4);

    expect(result).toContain('Light getLight(uint index)');
    expect(result).toContain('texelFetch(uLightStorage');
  });

  it('should embed the stride in the generated code', () => {
    const result = generateGlslStorageAccessor('Material', { baseColor: 'vec4<f32>' }, 8);

    expect(result).toContain('int base = mi * 8;');
  });

  it('should include auto-generated JSDoc comment', () => {
    const result = generateGlslStorageAccessor('Material', { baseColor: 'vec4<f32>' }, 6);

    expect(result).toContain('Auto-generated from Material struct bindings');
    expect(result).toContain('Do not edit manually');
  });

  it('should handle vec2 fields with correct swizzle', () => {
    const result = generateGlslStorageAccessor(
      'Custom',
      {
        scale: 'vec2<f32>',
        intensity: 'f32',
      },
      6,
    );

    expect(result).toContain('m.scale = t0.xy;');
    expect(result).toContain('m.intensity = t0.z;');
  });
});
