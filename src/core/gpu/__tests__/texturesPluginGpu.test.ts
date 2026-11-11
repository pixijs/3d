import { describe, expect, it } from 'vitest';

import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { materialTextureAccessPlugin } from '~/core/gpu/codegen/materialTextureAccessPlugin';
import { createTexturesPluginGpu } from '~/core/gpu/shader/texturesPluginGpu';
import { materialStructPackPlugin } from '~/core/shader/codegen/materialStructPackPlugin';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';

import { compilationErrors } from './compilationErrors';

const template: ShaderBitTemplate = {
  bindGroups: ['global', 'batch'],
  gpu: `{{header}}
{{textureGetters}}

@vertex
fn mainVertex(@location(0) uv: vec2<f32>, @location(1) vMaterialIndex: u32) -> @builtin(position) vec4<f32> {
  {{vertexStoreAccess}}
  return vec4<f32>(uv + sampleBaseColorDirect(uv).xy * material.shine, 0.0, 1.0);
}

@fragment
fn mainFragment(@location(0) uv: vec2<f32>, @location(1) @interpolate(flat) vMaterialIndex: u32) -> @location(0) vec4<f32> {
  {{fragmentStoreAccess}}
  return sampleBaseColor(uv) + sampleBaseColorDirect(uv) * material.tint;
}`,
};

const texturesBit: ShaderBit = { name: 'test', textures: ['baseColor', 'normal'] };

const materialBit: ShaderBit = { name: 'testMaterial', bindings: { material: { shine: 'f32', tint: 'vec4<f32>' } } };

const storeBit: ShaderBit = { name: 'testStore', bindings: { global: { uMaterialStorage: 'texture_2d<u32>' } } };

const compileDirect = (extra: readonly ShaderBit[] = [materialBit]) =>
  compileWgslSource({
    bits: [texturesBit, ...extra],
    template,
    extraPlugins: [materialStructPackPlugin, createTexturesPluginGpu('direct')],
  }).fragment.source;

const compileMerged = (extra: readonly ShaderBit[] = [materialBit]) =>
  compileWgslSource({
    bits: [texturesBit, storeBit, ...extra],
    template,
    extraPlugins: [materialStructPackPlugin, materialTextureAccessPlugin, createTexturesPluginGpu('merged')],
  }).fragment.source;

describe('texturesPluginGpu', () => {
  it('generates WGSL a real device accepts in both stages, in both forms', async () => {
    const gpu = navigator.gpu;
    expect(gpu).toBeTruthy();
    const adapter = await gpu.requestAdapter();
    expect(adapter).toBeTruthy();
    const device = await adapter!.requestDevice();

    try {
      expect(
        await compilationErrors(device, compileDirect()),
        'the Direct getter reaches no fragment-only builtin',
      ).toEqual([]);
      expect(await compilationErrors(device, compileMerged())).toEqual([]);
    } finally {
      device.destroy();
    }
  });

  it('the direct form declares no uniform group for bits with no material fields', () => {
    const source = compileDirect([]);

    expect(source).toContain('@group(1) @binding(3) var uMaterialSampler1: sampler;');
    expect(source).not.toContain('var<uniform> material');
    expect(source).not.toContain('struct Material');
  });
});
