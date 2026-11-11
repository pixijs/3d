import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { createLightingBit } from '~/core/shader/createLightingBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { sheenBit } from '~/materials/pbr/bits/sheenBit';

const hostLighting = createLightingBit({
  name: 'hostLighting',
  preLighting: {
    gpu: 'var directLight = vec3<f32>(0.0);\nlet nDotV = max(dot(normal, viewDir), 0.0);',
    gl: 'vec3 directLight = vec3(0.0);\nfloat nDotV = max(dot(normal, viewDir), 0.0);',
  },
  perLight: {
    gpu: `
      let halfVector = normalize(viewDir + lightDir);
      let nDotH = max(dot(normal, halfVector), 0.0);
      directLight += light.color * nDotL * attenuation * shadow;
    `,
    gl: `
      vec3 halfVector = normalize(viewDir + lightDir);
      float nDotH = max(dot(normal, halfVector), 0.0);
      directLight += light.color * nDotL * attenuation * shadow;
    `,
  },
  postLighting: {
    gpu: 'finalColor = directLight;',
    gl: 'finalColor = directLight;',
  },
});

const wgslTemplate: ShaderBitTemplate = {
  bindGroups: [],
  gpu: '{{header}}\n{{fragmentLighting}}',
};

const glslTemplate: ShaderBitTemplate = {
  bindGroups: [],
  gl: {
    vertex: '{{header}}\nvoid main() {}',
    fragment: '{{header}}\nvoid main() { {{lighting}} }',
  },
};

describe("sheenBit splices into the host lighting bit's one light loop", () => {
  describe('WGSL composition with a host lighting bit', () => {
    const out = compileWgslSource({
      bits: [hostLighting, sheenBit],
      template: wgslTemplate,
    });
    const src = out.fragment.source;

    it("undoes pixi's premultiplied upload before sRGB-decoding the colour, since alpha holds roughness", () => {
      expect(src).toMatch(/sheenTex\.rgb\s*\/\s*max\s*\(\s*sheenTex\.a/);
      expect(src).toMatch(/pow\(sheenTexStraight,\s*vec3(?:<f32>)?\(2\.2\)\)/);
    });
  });

  describe('GLSL composition with a host lighting bit', () => {
    const out = compileGlslSource({
      bits: [hostLighting, sheenBit],
      template: glslTemplate,
    });
    const src = out.fragment;

    it("undoes pixi's premultiplied upload before sRGB-decoding the colour, since alpha holds roughness", () => {
      expect(src).toMatch(/sheenTex\.rgb\s*\/\s*max\s*\(\s*sheenTex\.a/);
      expect(src).toMatch(/pow\(sheenTexStraight,\s*vec3(?:<f32>)?\(2\.2\)\)/);
    });
  });
});
