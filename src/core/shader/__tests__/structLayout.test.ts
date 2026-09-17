import { describe, expect, it } from 'vitest';

import { createStructLayout } from '~/core/shader/codegen/structLayout';

describe('createStructLayout', () => {
  it('should layout a single f32 field', () => {
    const layout = createStructLayout({ roughness: 'f32' });

    expect(layout.elements).toHaveLength(1);
    expect(layout.elements[0]).toEqual({
      name: 'roughness',
      type: 'f32',
      offset: 0,
      size: 4,
      components: 1,
    });
    expect(layout.size).toBe(4);
  });

  it('should layout a single vec4', () => {
    const layout = createStructLayout({ baseColor: 'vec4<f32>' });

    expect(layout.elements).toHaveLength(1);
    expect(layout.elements[0]).toEqual({
      name: 'baseColor',
      type: 'vec4<f32>',
      offset: 0,
      size: 16,
      components: 4,
    });
    expect(layout.size).toBe(16);
  });

  it('should align vec3 to 16 bytes and pad correctly', () => {
    const layout = createStructLayout({
      normal: 'vec3<f32>',
      factor: 'f32',
    });

    expect(layout.elements).toHaveLength(2);
    expect(layout.elements[0]).toEqual({
      name: 'normal',
      type: 'vec3<f32>',
      offset: 0,
      size: 12,
      components: 3,
    });
    // f32 after vec3: vec3 occupies bytes 0–11, f32 (align 4) fits at byte 12
    expect(layout.elements[1]).toEqual({
      name: 'factor',
      type: 'f32',
      offset: 12,
      size: 4,
      components: 1,
    });
    // struct align = 16 (from vec3), total raw = 16, aligned = 16
    expect(layout.size).toBe(16);
  });

  it('should align vec2 to 8 bytes', () => {
    const layout = createStructLayout({
      intensity: 'f32',
      scale: 'vec2<f32>',
    });

    expect(layout.elements[0].offset).toBe(0); // f32 at 0
    expect(layout.elements[1].offset).toBe(8); // vec2 aligns to 8
    expect(layout.size).toBe(16); // 8 + 8 = 16, struct align = 8, already aligned
  });

  // oxlint-disable-next-line jest/no-disabled-tests
  it.skip('should compute correct layout for full PBR material struct', () => {
    const layout = createStructLayout({
      baseColor: 'vec4<f32>',
      emissive: 'vec3<f32>',
      alphaCutoff: 'f32',
      pbrParams: 'vec4<f32>',
      transmissionVolume: 'vec4<f32>',
      attenuationColorIrid: 'vec4<f32>',
      iridescenceThickness: 'f32',
    });

    expect(layout.elements).toHaveLength(7);
    expect(layout.elements[0].offset).toBe(0); // baseColor
    expect(layout.elements[1].offset).toBe(16); // emissive (vec3, align 16)
    expect(layout.elements[2].offset).toBe(28); // alphaCutoff (f32 fills vec3 padding)
    expect(layout.elements[3].offset).toBe(32); // pbrParams
    expect(layout.elements[4].offset).toBe(48); // transmissionVolume
    expect(layout.elements[5].offset).toBe(64); // attenuationColorIrid
    expect(layout.elements[6].offset).toBe(80); // iridescenceThickness
    // struct align = 16, raw end = 84, aligned = 96
    expect(layout.size).toBe(96);
  });

  // oxlint-disable-next-line jest/no-disabled-tests
  it.skip('should handle vec3 followed by vec3 with correct alignment gap', () => {
    const layout = createStructLayout({
      a: 'vec3<f32>',
      b: 'vec3<f32>',
    });

    expect(layout.elements[0].offset).toBe(0); // a: bytes 0–11
    expect(layout.elements[1].offset).toBe(16); // b: aligned to 16
    // raw end = 28, struct align = 16, aligned = 32
    expect(layout.size).toBe(32);
  });

  it('should handle mixed scalar types', () => {
    const layout = createStructLayout({
      x: 'f32',
      y: 'i32',
      z: 'u32',
    });

    expect(layout.elements[0].offset).toBe(0);
    expect(layout.elements[1].offset).toBe(4);
    expect(layout.elements[2].offset).toBe(8);
    expect(layout.size).toBe(12);
  });

  it('should skip unknown types gracefully', () => {
    const layout = createStructLayout({
      baseColor: 'vec4<f32>',
      unknown: 'some_fake_type_that_pixi_doesnt_know',
      roughness: 'f32',
    });

    expect(layout.elements).toHaveLength(2);
    expect(layout.elements[0].name).toBe('baseColor');
    expect(layout.elements[1].name).toBe('roughness');
    expect(layout.elements[1].offset).toBe(16);
  });

  it('should return empty layout for empty fields', () => {
    const layout = createStructLayout({});

    expect(layout.elements).toHaveLength(0);
    expect(layout.size).toBe(0);
  });

  it('should match float offsets used by the sync function', () => {
    const layout = createStructLayout({
      color: 'vec4<f32>',
      position: 'vec3<f32>',
      scale: 'f32',
      tiling: 'vec2<f32>',
    });

    // color:    vec4, offset 0,  size 16 → end 16
    // position: vec3, align 16, offset 16, size 12 → end 28
    // scale:    f32,  align 4,  offset 28, size 4  → end 32
    // tiling:   vec2, align 8,  offset 32, size 8  → end 40
    expect(layout.elements[0].offset).toBe(0);
    expect(layout.elements[1].offset).toBe(16);
    expect(layout.elements[2].offset).toBe(28);
    expect(layout.elements[3].offset).toBe(32);

    const floatOffsets = layout.elements.map((e) => e.offset / 4);
    expect(floatOffsets).toEqual([0, 4, 7, 8]);
  });
});
