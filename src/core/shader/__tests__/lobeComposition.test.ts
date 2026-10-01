import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { createLightingBit } from '~/core/shader/createLightingBit';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';

const lambertHost = createLightingBit({
  name: 'lambertHost',
  preLighting: {
    gpu: 'var directLight = vec3<f32>(0.0);',
    gl: 'vec3 directLight = vec3(0.0);',
  },
  perLight: {
    gpu: 'directLight += light.color * nDotL * attenuation * shadow;',
    gl: 'directLight += light.color * nDotL * attenuation * shadow;',
  },
  postLighting: {
    gpu: 'finalColor = directLight;',
    gl: 'finalColor = directLight;',
  },
});

function makeLobeBit(name: string, marker: string): ShaderBit {
  return {
    name,
    gpu: {
      fragment: {
        lobePreLighting: `var ${marker}_pre = 0.0;`,
        lobePerLight: `${marker}_per();`,
        lobePostLighting: `${marker}_post();`,
      },
    },
    gl: {
      fragment: {
        lobePreLighting: `float ${marker}_pre = 0.0;`,
        lobePerLight: `${marker}_per();`,
        lobePostLighting: `${marker}_post();`,
      },
    },
  };
}

const wgslTemplate: ShaderBitTemplate = {
  bindGroups: [],
  gpu: '{{fragmentLighting}}',
};

const glslTemplate: ShaderBitTemplate = {
  bindGroups: [],
  gl: {
    vertex: '{{header}}\nvoid main() {}',
    fragment: '{{header}}\nvoid main() { {{lighting}} }',
  },
};

describe("lobe slots resolve through the markers in the host lighting bit's body, with no lobe plugin", () => {
  describe('WGSL', () => {
    it('produces exactly one for-loop regardless of lobe count', () => {
      const out = compileWgslSource({
        bits: [lambertHost, makeLobeBit('clearcoat', 'cc'), makeLobeBit('sheen', 'sh')],
        template: wgslTemplate,
      });
      const loopMatches = out.fragment.source.match(/for \(var n: i32 = 0;/g) ?? [];
      expect(loopMatches.length).toBe(1);
    });

    it('splices lobePreLighting before the loop, lobePerLight inside it and lobePostLighting after it', () => {
      const out = compileWgslSource({
        bits: [lambertHost, makeLobeBit('clearcoat', 'cc')],
        template: wgslTemplate,
      });
      const src = out.fragment.source;

      const preIdx = src.indexOf('cc_pre');
      const perIdx = src.indexOf('cc_per');
      const postIdx = src.indexOf('cc_post');
      const loopOpenIdx = src.indexOf('for (var n: i32 = 0;');
      const loopCloseIdx = src.indexOf('}', perIdx);

      expect(preIdx).toBeGreaterThan(-1);
      expect(perIdx).toBeGreaterThan(-1);
      expect(postIdx).toBeGreaterThan(-1);

      expect(preIdx).toBeLessThan(loopOpenIdx);
      expect(perIdx).toBeGreaterThan(loopOpenIdx);
      expect(perIdx).toBeLessThan(loopCloseIdx);
      expect(postIdx).toBeGreaterThan(loopCloseIdx);
    });

    it('orders lobes by their place in the bit list, in every phase', () => {
      const out = compileWgslSource({
        bits: [lambertHost, makeLobeBit('sheen', 'sh'), makeLobeBit('clearcoat', 'cc')],
        template: wgslTemplate,
      });
      const src = out.fragment.source;
      expect(src.indexOf('sh_pre')).toBeLessThan(src.indexOf('cc_pre'));
      expect(src.indexOf('sh_per')).toBeLessThan(src.indexOf('cc_per'));
      expect(src.indexOf('sh_post')).toBeLessThan(src.indexOf('cc_post'));
    });
  });

  describe('GLSL', () => {
    it('produces exactly one light loop regardless of lobe count', () => {
      const out = compileGlslSource({
        bits: [lambertHost, makeLobeBit('clearcoat', 'cc'), makeLobeBit('sheen', 'sh')],
        template: glslTemplate,
      });
      const loopMatches = out.fragment.match(/for \(int n = 0;/g) ?? [];
      expect(loopMatches.length).toBe(1);
    });

    it('splices lobePreLighting before the loop, lobePerLight inside it and lobePostLighting after it', () => {
      const out = compileGlslSource({
        bits: [lambertHost, makeLobeBit('clearcoat', 'cc')],
        template: glslTemplate,
      });

      const preIdx = out.fragment.indexOf('cc_pre');
      const perIdx = out.fragment.indexOf('cc_per');
      const postIdx = out.fragment.indexOf('cc_post');
      const loopOpenIdx = out.fragment.indexOf('for (int n = 0;');
      const loopCloseIdx = out.fragment.indexOf('}', perIdx);

      expect(preIdx).toBeLessThan(loopOpenIdx);
      expect(perIdx).toBeGreaterThan(loopOpenIdx);
      expect(perIdx).toBeLessThan(loopCloseIdx);
      expect(postIdx).toBeGreaterThan(loopCloseIdx);
    });
  });
});
