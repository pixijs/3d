import { describe, expect, it } from 'vitest';

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
  });
});
