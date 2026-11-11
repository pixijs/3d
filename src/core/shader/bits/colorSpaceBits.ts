import type { BaseMaterial3D } from '../../../materials/BaseMaterial3D';
import type { ShaderBit } from '../ShaderBit';
import { srgbEncodeBit } from './tonemapping/srgbEncodeBit';

function helpers(name: string, color: string, input: 'linear' | 'display', frame: string): ShaderBit {
  const wgsl = /*wgsl*/ `
fn decodeColor(c: vec3<f32>) -> vec3<f32> { return ${color.replace('VEC3', 'vec3<f32>')}; }
fn inputTint(linearTint: vec4<f32>, displayTint: vec4<f32>) -> vec4<f32> { return ${input}Tint; }
fn inputExposure(linearExposure: f32, displayExposure: f32) -> f32 { return ${input}Exposure; }
fn decodeFrame(c: vec3<f32>) -> vec3<f32> { return ${frame.replace('VEC3', 'vec3<f32>')}; }
`;
  const glsl = /*glsl*/ `
vec3 decodeColor(vec3 c) { return ${color.replace('VEC3', 'vec3')}; }
vec4 inputTint(vec4 linearTint, vec4 displayTint) { return ${input}Tint; }
float inputExposure(float linearExposure, float displayExposure) { return ${input}Exposure; }
vec3 decodeFrame(vec3 c) { return ${frame.replace('VEC3', 'vec3')}; }
`;

  return {
    name,
    gpu: { header: wgsl },
    gl: { header: glsl },
  };
}

const linearColorSpaceBit: ShaderBit = helpers('colorSpaceLinear', 'pow(c, VEC3(2.2))', 'linear', 'pow(c, VEC3(2.2))');

const linearFramesColorSpaceBit: ShaderBit = helpers('colorSpaceLinearFrames', 'pow(c, VEC3(2.2))', 'linear', 'c');

/**
 * Gives the same bytes as linear light only while the encode is a pure 2.2 gamma, which the
 * decode then cancels
 * @internal
 */
export const displayColorSpaceBit: ShaderBit = helpers('colorSpaceDisplay', 'c', 'display', 'c');

/**
 * Picks display space only for a `colorSpace: 'display'` material where it gives the same bytes as
 * linear light: unlit, ending in the encode alone, with nothing mixed in linear light
 * @internal
 */
export function selectColorSpaceBit(
  material: BaseMaterial3D,
  toneBit: ShaderBit | null,
  linearInputs: boolean,
): ShaderBit {
  if (!toneBit) return linearFramesColorSpaceBit;

  const encodeOnly = material._skipsToneCurve || toneBit === srgbEncodeBit;
  const display = material.colorSpace === 'display' && !material.lit && encodeOnly && !linearInputs;

  return display ? displayColorSpaceBit : linearColorSpaceBit;
}
