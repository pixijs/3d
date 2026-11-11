import type { TEXTURE_FORMATS } from 'pixi.js';

import type { ShaderBit } from '../ShaderBit';

const srgbDecodeBit: ShaderBit = {
  name: 'decodeToLinearSrgb',
  gpu: { header: /*wgsl*/ 'fn decodeToLinear(c: vec3<f32>) -> vec3<f32> { return pow(c, vec3<f32>(2.2)); }' },
  gl: { header: /*glsl*/ 'vec3 decodeToLinear(vec3 c) { return pow(c, vec3(2.2)); }' },
};

const linearDecodeBit: ShaderBit = {
  name: 'decodeToLinearNone',
  gpu: { header: /*wgsl*/ 'fn decodeToLinear(c: vec3<f32>) -> vec3<f32> { return c; }' },
  gl: { header: /*glsl*/ 'vec3 decodeToLinear(vec3 c) { return c; }' },
};

/**
 * For the opaque copy, pass whether the materials tone-map, since its format can't tell under
 * `toneMapping: 'custom'`
 * @internal
 */
export function decodeToLinearBit(encoded: boolean): ShaderBit {
  return encoded ? srgbDecodeBit : linearDecodeBit;
}

/** @internal */
export function isLinearFormat(format: TEXTURE_FORMATS): boolean {
  return format.includes('float') || format.endsWith('-srgb');
}
