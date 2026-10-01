import { describe, expect, it } from 'vitest';

import { packStructFields } from '~/core/shader/codegen/packStructFields';
import { createStructLayout } from '~/core/shader/codegen/structLayout';
import type { StructDefinition } from '~/core/shader/ShaderBit';

describe('packStructFields', () => {
  it('should order by alignment tier, mat4 → vec4 → vec3 → vec2 → scalars, pull the first scalar into the vec3 tail and keep every type', () => {
    const def = {
      a: 'f32',
      b: 'vec2<f32>',
      c: 'vec3<f32>',
      d: 'vec4<f32>',
      e: 'mat4x4<f32>',
      f: 'u32',
    } as StructDefinition;

    const packed = packStructFields(def);

    expect(Object.keys(packed)).toEqual(['e', 'd', 'c', 'a', 'b', 'f']);
    expect(packed).toEqual(def);
  });

  it('should preserve declaration order within a tier (stable sort)', () => {
    const def = {
      colorA: 'vec4<f32>',
      x: 'f32',
      colorB: 'vec4<f32>',
      y: 'f32',
      colorC: 'vec4<f32>',
    } as StructDefinition;

    const packed = packStructFields(def);

    expect(Object.keys(packed)).toEqual(['colorA', 'colorB', 'colorC', 'x', 'y']);
  });

  it('should be idempotent', () => {
    const def = {
      time: 'f32',
      color: 'vec4<f32>',
      normal: 'vec3<f32>',
      tiling: 'vec2<f32>',
    } as StructDefinition;

    const once = packStructFields(def);
    const twice = packStructFields(once);

    expect(Object.keys(once)).toEqual(['color', 'normal', 'time', 'tiling']);
    expect(Object.keys(twice)).toEqual(Object.keys(once));
    expect(twice).toEqual(once);
  });

  it('should sort types without alignment data (e.g. array padding) last, in declaration order', () => {
    const def = {
      pad: 'array<f32, 4>',
      a: 'f32',
      color: 'vec4<f32>',
    } as unknown as StructDefinition;

    const packed = packStructFields(def);

    expect(Object.keys(packed)).toEqual(['color', 'a', 'pad']);
  });

  it('should pair each vec3 of a water material with a scalar: 44 bytes of data, 52 in declaration order, 44 packed', () => {
    const naive = {
      time: 'f32',
      waveStrength: 'f32',
      shallowColor: 'vec3<f32>',
      maxDepthDistance: 'f32',
      deepColor: 'vec3<f32>',
      refractionStrength: 'f32',
      foamDistance: 'f32',
    } as StructDefinition;

    const packed = packStructFields(naive);

    expect(Object.keys(packed)).toEqual([
      'shallowColor',
      'time',
      'deepColor',
      'waveStrength',
      'maxDepthDistance',
      'refractionStrength',
      'foamDistance',
    ]);

    expect(createStructLayout(naive).size).toBe(52);
    expect(createStructLayout(packed).size).toBe(44);
  });

  it('should collapse the 12-byte hole each scalar declared before a vec4 leaves', () => {
    const naive = {
      a: 'f32',
      col1: 'vec4<f32>',
      b: 'f32',
      col2: 'vec4<f32>',
      c: 'f32',
      col3: 'vec4<f32>',
    } as StructDefinition;

    const packed = packStructFields(naive);

    expect(createStructLayout(naive).size).toBe(96);
    expect(createStructLayout(packed).size).toBe(60);
  });

  it('should pad only the vec3s left without a scalar to fill their tail', () => {
    const def = {
      v1: 'vec3<f32>',
      v2: 'vec3<f32>',
      v3: 'vec3<f32>',
      s: 'f32',
    } as StructDefinition;

    const packed = packStructFields(def);

    expect(Object.keys(packed)).toEqual(['v1', 's', 'v2', 'v3']);
    expect(createStructLayout(packed).size).toBe(44);
  });
});
