import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { materialUniformAccessPluginGl } from '~/core/gl/codegen/materialUniformAccessPluginGl';
import { createTexturesPluginGl } from '~/core/gl/shader/texturesPluginGl';
import { materialStructPackPlugin } from '~/core/shader/codegen/materialStructPackPlugin';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';

const template: ShaderBitTemplate = {
  bindGroups: ['batch'],
  gl: {
    vertex: `#version 300 es
{{header}}
{{textureGetters}}
in vec2 aUV;
void main() {
  {{storeAccess}}
  gl_Position = vec4(aUV + sampleBaseColorDirect(aUV).xy * material.shine, 0.0, 1.0);
}`,
    fragment: `#version 300 es
{{header}}
out vec4 fragColor;
{{textureGetters}}
void main() {
  {{storeAccess}}
  vec2 uv = gl_FragCoord.xy;
  fragColor = sampleBaseColor(uv) + sampleNormalDirect(uv) * material.tint;
}`,
  },
};

const texturesBit: ShaderBit = { name: 'test', textures: ['baseColor', 'normal'] };

const materialBit: ShaderBit = { name: 'testMaterial', bindings: { material: { shine: 'f32', tint: 'vec4<f32>' } } };

const compileDirect = (extra: readonly ShaderBit[] = [materialBit]) =>
  compileGlslSource({
    bits: [texturesBit, ...extra],
    template,
    extraPlugins: [materialStructPackPlugin, materialUniformAccessPluginGl, createTexturesPluginGl('direct')],
    useLocations: false,
  });

describe('the direct textures plugin and material uniform accessor on WebGL', () => {
  it('getters read unit t straight: mip 0 in both stages, the implicit level in the fragment stage only', () => {
    const { vertex, fragment } = compileDirect();

    for (const source of [vertex, fragment]) {
      expect(source).toContain(
        'vec4 sampleBaseColorDirect(vec2 uv) {\n  return textureLod(uMaterialTexture0, uv, 0.0);',
      );
      expect(source).toContain('vec4 sampleNormalDirect(vec2 uv) {\n  return textureLod(uMaterialTexture1, uv, 0.0);');
    }
    expect(fragment).toContain('vec4 sampleBaseColor(vec2 uv) {\n  return texture(uMaterialTexture0, uv);');
    expect(fragment).toContain('vec4 sampleNormal(vec2 uv) {\n  return texture(uMaterialTexture1, uv);');
    expect(vertex).not.toContain('vec4 sampleBaseColor(');
  });

  it('declares any uniform<Struct> binding as a block of that struct, and refuses a member std140 lays out unlike WGSL', () => {
    const glowBit: ShaderBit = {
      name: 'testGlow',
      structs: { Glow: { color: 'vec4<f32>', spread: 'f32' } },
      bindings: { batch: { glow: 'uniform<Glow>' } },
    };
    const { fragment, groupMap } = compileDirect([materialBit, glowBit]);

    expect(fragment).toContain('layout(std140) uniform glow {\n  vec4 color;\n  float spread;\n} uGlow;');
    expect(groupMap[0][5]).toBe('glow');

    const wideBit: ShaderBit = {
      name: 'testWide',
      structs: { Wide: { rows: 'mat3x2<f32>' } },
      bindings: { batch: { wide: 'uniform<Wide>' } },
    };
    expect(() => compileDirect([wideBit])).toThrow(/"rows" of uniform block "wide" is "mat3x2<f32>"/);

    const lostBit: ShaderBit = { name: 'testLost', bindings: { batch: { lost: 'uniform<Lost>' } } };
    expect(() => compileDirect([lostBit])).toThrow(
      /"lost" is "uniform<Lost>", but no bit declares fields for a "Lost" struct/,
    );
  });
});
