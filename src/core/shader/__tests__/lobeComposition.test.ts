import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { createLightingBit } from '~/core/shader/createLightingBit';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';

/**
 * Lobe composition is implemented as a *convention* on top of the existing
 * stage-slot mechanism — there is no dedicated plugin or `lobe` field on
 * ShaderBit. A lobe-bearing bit just emits into `gpu.fragment.lobePerLight`
 * (etc.) and the host's `createLightingBit`-generated body references those
 * via nested template markers, which `fillTemplateSlots` resolves on its
 * second substitution pass. These tests cover the end-to-end behaviour.
 */

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

// Minimal templates — just enough to exercise the lighting slot. Real materials
// use the full Material3D template; the marker plumbing is identical.
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

describe('lobe composition (via stage slots + recursive fillTemplateSlots)', () => {
  describe('WGSL', () => {
    it('produces exactly one for-loop regardless of lobe count', () => {
      const out = compileWgslSource({
        bits: [lambertHost, makeLobeBit('clearcoat', 'cc'), makeLobeBit('sheen', 'sh')],
        template: wgslTemplate,
      });
      const loopMatches = out.fragment.source.match(/for \(var i: i32 = 0;/g) ?? [];
      expect(loopMatches.length).toBe(1);
    });

    it('splices each lobe phase at the correct position', () => {
      const out = compileWgslSource({
        bits: [lambertHost, makeLobeBit('clearcoat', 'cc')],
        template: wgslTemplate,
      });
      const src = out.fragment.source;

      const preIdx = src.indexOf('cc_pre');
      const perIdx = src.indexOf('cc_per');
      const postIdx = src.indexOf('cc_post');
      const loopOpenIdx = src.indexOf('for (var i: i32 = 0;');
      const loopCloseIdx = src.indexOf('}', perIdx); // first `}` after the perLight injection

      expect(preIdx).toBeGreaterThan(-1);
      expect(perIdx).toBeGreaterThan(-1);
      expect(postIdx).toBeGreaterThan(-1);

      // preLighting is before the loop; perLight is inside; postLighting is after.
      expect(preIdx).toBeLessThan(loopOpenIdx);
      expect(perIdx).toBeGreaterThan(loopOpenIdx);
      expect(perIdx).toBeLessThan(loopCloseIdx);
      expect(postIdx).toBeGreaterThan(loopCloseIdx);
    });

    it('orders lobes by descriptor declaration order', () => {
      // Sheen pushed before clearcoat → sheen runs first in every phase.
      const out = compileWgslSource({
        bits: [lambertHost, makeLobeBit('sheen', 'sh'), makeLobeBit('clearcoat', 'cc')],
        template: wgslTemplate,
      });
      const src = out.fragment.source;
      expect(src.indexOf('sh_pre')).toBeLessThan(src.indexOf('cc_pre'));
      expect(src.indexOf('sh_per')).toBeLessThan(src.indexOf('cc_per'));
      expect(src.indexOf('sh_post')).toBeLessThan(src.indexOf('cc_post'));
    });

    it('leaves no surviving lobe markers in the output', () => {
      const out = compileWgslSource({
        bits: [lambertHost, makeLobeBit('clearcoat', 'cc')],
        template: wgslTemplate,
      });
      expect(out.fragment.source).not.toContain('{{');
    });

    it('expands lobe markers to nothing when no lobe bits are present', () => {
      const out = compileWgslSource({ bits: [lambertHost], template: wgslTemplate });
      const src = out.fragment.source;
      expect(src).not.toContain('{{');
      // Host code is intact.
      expect(src).toContain('var directLight = vec3<f32>(0.0);');
      expect(src).toContain('finalColor = directLight;');
    });
  });

  describe('GLSL', () => {
    it('produces exactly one for-loop regardless of lobe count', () => {
      const out = compileGlslSource({
        bits: [lambertHost, makeLobeBit('clearcoat', 'cc'), makeLobeBit('sheen', 'sh')],
        template: glslTemplate,
      });
      const loopMatches = out.fragment.match(/for \(int i = 0;/g) ?? [];
      expect(loopMatches.length).toBe(1);
    });

    it('splices each lobe phase at the correct position', () => {
      const out = compileGlslSource({
        bits: [lambertHost, makeLobeBit('clearcoat', 'cc')],
        template: glslTemplate,
      });

      const preIdx = out.fragment.indexOf('cc_pre');
      const perIdx = out.fragment.indexOf('cc_per');
      const postIdx = out.fragment.indexOf('cc_post');
      const loopOpenIdx = out.fragment.indexOf('for (int i = 0;');
      const loopCloseIdx = out.fragment.indexOf('}', perIdx);

      expect(preIdx).toBeLessThan(loopOpenIdx);
      expect(perIdx).toBeGreaterThan(loopOpenIdx);
      expect(perIdx).toBeLessThan(loopCloseIdx);
      expect(postIdx).toBeGreaterThan(loopCloseIdx);
    });

    it('vertex stage is unaffected by lobe slot emissions', () => {
      // Lobes only contribute to the fragment stage. The vertex template here
      // has no lobe markers; we confirm it compiles cleanly.
      const out = compileGlslSource({
        bits: [lambertHost, makeLobeBit('clearcoat', 'cc')],
        template: glslTemplate,
      });
      expect(out.vertex).not.toContain('{{');
      expect(out.vertex).not.toContain('cc_per');
    });

    it('expands lobe markers to nothing when no lobe bits are present', () => {
      const out = compileGlslSource({ bits: [lambertHost], template: glslTemplate });
      expect(out.fragment).not.toContain('{{');
      expect(out.fragment).toContain('vec3 directLight = vec3(0.0);');
      expect(out.fragment).toContain('finalColor = directLight;');
    });
  });
});
