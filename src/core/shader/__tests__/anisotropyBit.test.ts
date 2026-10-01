import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import {
  anisotropyBit,
  anisotropyTangentBit,
  anisotropyTangentVariant,
  anisotropyTextureBit,
  anisotropyTextureTangentBit,
} from '~/core/shader/bits/anisotropyBit';
import { createLightingBit } from '~/core/shader/createLightingBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';

/**
 * A host lighting bit with `pbrLightingBit`'s contract for the lobe: `a` and `nDotV` before the
 * loop, and `halfVector`, `nDotH`, `fresnel`, `specular` and `radiance` inside it
 */
const hostLighting = createLightingBit({
  name: 'hostLightingAniso',
  preLighting: {
    gpu: 'var directLight = vec3<f32>(0.0);\nlet nDotV = max(dot(normal, viewDir), 0.0);\nlet a = roughness * roughness;',
    gl: 'vec3 directLight = vec3(0.0);\nfloat nDotV = max(dot(normal, viewDir), 0.0);\nfloat a = roughness * roughness;',
  },
  perLight: {
    gpu: `
      let halfVector = normalize(viewDir + lightDir);
      let nDotH = max(dot(normal, halfVector), 0.0);
      let fresnel = vec3<f32>(0.04);
      let specular = vec3<f32>(0.0);
      let radiance = light.color * attenuation;
      directLight += specular * radiance * nDotL * shadow;
    `,
    gl: `
      vec3 halfVector = normalize(viewDir + lightDir);
      float nDotH = max(dot(normal, halfVector), 0.0);
      vec3 fresnel = vec3(0.04);
      vec3 specular = vec3(0.0);
      vec3 radiance = light.color * attenuation;
      directLight += specular * radiance * nDotL * shadow;
    `,
  },
  postLighting: {
    gpu: 'finalColor = directLight;',
    gl: 'finalColor = directLight;',
  },
});

/** Both templates have the material slot, where the bit builds its tangent frame and bent normal */
const wgslTemplate: ShaderBitTemplate = {
  bindGroups: [],
  gpu: '{{header}}\n{{fragmentMaterial}}\n{{fragmentLighting}}',
};

const glslTemplate: ShaderBitTemplate = {
  bindGroups: [],
  gl: {
    vertex: '{{header}}\nvoid main() {}',
    fragment: '{{header}}\nvoid main() { {{material}} {{lighting}} }',
  },
};

describe('anisotropyBit, a lobe that replaces the base specular rather than adding to it', () => {
  describe('metadata', () => {
    it('keeps one struct binding and texture list across the tangent variants, which the renderer swaps per mesh', () => {
      expect(anisotropyTangentBit.bindings?.material).toEqual({ anisotropyParams: 'vec4<f32>' });
      expect(anisotropyTextureTangentBit.bindings?.material).toEqual({ anisotropyParams: 'vec4<f32>' });
      expect(anisotropyTangentBit.textures).toEqual([]);
      expect(anisotropyTextureTangentBit.textures).toEqual(['anisotropy']);
    });

    it('maps deriv bits to their tangent variants (and passes others through)', () => {
      expect(anisotropyTangentVariant(anisotropyBit)).toBe(anisotropyTangentBit);
      expect(anisotropyTangentVariant(anisotropyTextureBit)).toBe(anisotropyTextureTangentBit);
      expect(anisotropyTangentVariant(hostLighting)).toBe(hostLighting);
    });
  });

  describe('vertex-tangent variant', () => {
    const out = compileWgslSource({
      bits: [hostLighting, anisotropyTextureTangentBit],
      template: wgslTemplate,
    });
    const src = out.fragment.source;

    it('consumes the vertex tangent varyings instead of a derivative TBN', () => {
      expect(src).toContain('input.vAnisoTangent');
      expect(src).toContain('input.vAnisoBitangent');
      expect(src).not.toContain('calculateAnisotropyTBN');
    });

    it('still emits the same anisotropic GGX delta + bent specularNormal', () => {
      expect(src).toMatch(/directLight \+= \(anisoSpec - specular\)/);
      expect(src).toMatch(/specularNormal = normalize\(mix\(/);
    });
  });

  describe('WGSL composition with a host lighting bit', () => {
    const out = compileWgslSource({
      bits: [hostLighting, anisotropyTextureBit],
      template: wgslTemplate,
    });
    const src = out.fragment.source;

    it('produces exactly one light loop (single shadow-sample path)', () => {
      const matches = src.match(/for \(var n: i32 = 0;/g) ?? [];
      expect(matches.length).toBe(1);
    });

    it('replaces the base specular by adding the anisotropic delta over it inside the loop, leaving diffuse alone', () => {
      expect(src).toMatch(/directLight \+= \(anisoSpec - specular\) \* radiance \* nDotL \* shadow/);
    });

    it('evaluates anisotropic GGX D + V (Burley / Heitz height-correlated)', () => {
      expect(src).toContain('let anisoD');
      expect(src).toContain('let anisoVis');
      expect(src).toContain('anisoAlphaT');
      expect(src).toContain('anisoAlphaB');
    });

    it('overrides the shared specularNormal slot with the bent normal (no IBL variant)', () => {
      expect(src).toMatch(/specularNormal = normalize\(mix\(/);
    });

    it('rotates the direction by the rotation param', () => {
      expect(src).toContain('material.anisotropyParams.y');
      expect(src).toContain('cos(anisoRot)');
      expect(src).toContain('sin(anisoRot)');
    });
  });

  describe('GLSL composition with a host lighting bit', () => {
    const out = compileGlslSource({
      bits: [hostLighting, anisotropyTextureBit],
      template: glslTemplate,
    });
    const src = out.fragment;

    it('produces exactly one light loop (single shadow-sample path)', () => {
      const matches = src.match(/for \(int n = 0;/g) ?? [];
      expect(matches.length).toBe(1);
    });

    it('replaces the base specular with the anisotropic GGX delta inside the loop', () => {
      expect(src).toMatch(/directLight \+= \(anisoSpec - specular\) \* radiance \* nDotL \* shadow/);
    });
  });
});
