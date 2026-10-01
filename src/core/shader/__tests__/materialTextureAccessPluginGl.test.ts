import { describe, expect, it } from 'vitest';

import { generateGlslMaterialAccessor } from '~/core/gl/codegen/materialTextureAccessPluginGl';

describe('generateGlslMaterialAccessor', () => {
  it('should group vec3 + f32 into one texel fetch with correct swizzles', () => {
    const result = generateGlslMaterialAccessor({ emissive: 'vec3<f32>', alphaCutoff: 'f32' });

    expect(result).toContain('m.emissive = uintBitsToFloat(t0.xyz);');
    expect(result).toContain('m.alphaCutoff = uintBitsToFloat(t0.w);');
    const fetchCount = (result.match(/texelFetch/g) || []).length;
    expect(fetchCount).toBe(1);
  });

  it('should handle vec2 fields with correct swizzle', () => {
    const result = generateGlslMaterialAccessor({ scale: 'vec2<f32>', intensity: 'f32' });

    expect(result).toContain('m.scale = uintBitsToFloat(t0.xy);');
    expect(result).toContain('m.intensity = uintBitsToFloat(t0.z);');
  });

  it('reads integer fields as their exact bits', () => {
    const signed = generateGlslMaterialAccessor({ baseColor: 'vec4<f32>', offset: 'i32' });

    expect(signed).toContain('uvec4 t1 = texelFetch(uMaterialStorage');
    expect(signed).toContain('m.offset = int(t1.x);');

    const result = generateGlslMaterialAccessor({ baseColor: 'vec4<f32>', flags: 'u32' });

    expect(result).toContain('m.flags = t1.x;');
  });
});
