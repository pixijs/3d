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
 * `anisotropyBit` is a lobe that *replaces* the base specular (vs clearcoat /
 * sheen which add on top). These tests pin:
 *
 *   1. Metadata: struct binding; the texture slot exists only on the texture
 *      variant.
 *   2. Composed with a host lighting bit it splices into the *single* light
 *      loop — no second `for (i in lights)`.
 *   3. The per-light math is the anisotropic GGX delta over the host's base
 *      `specular` (`directLight += (anisoSpec - specular) * ...`), so the net
 *      specular is the anisotropic term and diffuse is untouched.
 *   4. The tangent frame is derived in the material slot (own TBN helper), and
 *      the shared `specularNormal` slot is overridden with the bent normal.
 *   5. Only the texture variant samples `sampleAnisotropy`.
 */

// Host mirroring pbrLightingBit's contract for the lobe: declares `a`, `nDotV`
// pre-loop and `halfVector` / `nDotH` / `fresnel` / `specular` / `radiance`
// inside the loop, exactly the locals the anisotropy lobe reads.
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

// Templates include the material marker so the bit's material-slot code (tangent
// frame + bent normal) is emitted alongside the lighting slot.
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

describe('anisotropyBit', () => {
  describe('metadata', () => {
    it('binds anisotropyParams as a vec4 in the material struct (both variants)', () => {
      expect(anisotropyBit.bindings?.material).toEqual({ anisotropyParams: 'vec4<f32>' });
      expect(anisotropyTextureBit.bindings?.material).toEqual({ anisotropyParams: 'vec4<f32>' });
    });

    it('allocates the texture slot only on the texture variant', () => {
      expect(anisotropyBit.textures).toEqual([]);
      expect(anisotropyTextureBit.textures).toEqual(['anisotropy']);
    });

    it('gives every variant a distinct name (shader-cache identity)', () => {
      expect(anisotropyBit.name).toBe('anisotropy');
      expect(anisotropyTextureBit.name).toBe('anisotropy:texture');
      expect(anisotropyTangentBit.name).toBe('anisotropy:tangent');
      expect(anisotropyTextureTangentBit.name).toBe('anisotropy:texture:tangent');
    });

    it('keeps the same struct binding + texture slots across tangent variants (stable layout)', () => {
      // MaterialSystemGpu swaps deriv<->tangent per-mesh, so the packed Material
      // layout and sample indices must not change.
      expect(anisotropyTangentBit.bindings?.material).toEqual({ anisotropyParams: 'vec4<f32>' });
      expect(anisotropyTextureTangentBit.bindings?.material).toEqual({ anisotropyParams: 'vec4<f32>' });
      expect(anisotropyTangentBit.textures).toEqual([]);
      expect(anisotropyTextureTangentBit.textures).toEqual(['anisotropy']);
    });

    it('only the tangent variants declare the aTangent attribute + their own varyings', () => {
      expect(anisotropyBit.attributes).toBeUndefined();
      expect(anisotropyTextureBit.attributes).toBeUndefined();
      // Distinct varying names from tangentNormalMappingBit's vTangent/vBitangent
      // so the two never collide when a mesh is both normal-mapped and anisotropic.
      expect(anisotropyTangentBit.attributes).toEqual({ aTangent: 'float32x4' });
      expect(anisotropyTangentBit.interStage).toEqual({
        vAnisoTangent: 'vec3<f32>',
        vAnisoBitangent: 'vec3<f32>',
      });
    });

    it('maps deriv bits to their tangent variants (and passes others through)', () => {
      expect(anisotropyTangentVariant(anisotropyBit)).toBe(anisotropyTangentBit);
      expect(anisotropyTangentVariant(anisotropyTextureBit)).toBe(anisotropyTextureTangentBit);
      // Non-anisotropy bits are returned unchanged.
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
      const matches = src.match(/for \(var i: i32 = 0;/g) ?? [];
      expect(matches.length).toBe(1);
    });

    it('replaces the base specular with the anisotropic GGX delta inside the loop', () => {
      // Net specular = anisotropic term; the delta over the host `specular`
      // keeps diffuse untouched and needs no change to pbrLightingBit.
      expect(src).toMatch(/directLight \+= \(anisoSpec - specular\) \* radiance \* nDotL \* shadow/);
    });

    it('evaluates anisotropic GGX D + V (Burley / Heitz height-correlated)', () => {
      expect(src).toContain('let anisoD');
      expect(src).toContain('let anisoVis');
      expect(src).toContain('anisoAlphaT');
      expect(src).toContain('anisoAlphaB');
    });

    it('derives the tangent frame from its own UV-derivative TBN helper', () => {
      expect(src).toContain('fn calculateAnisotropyTBN(');
      expect(src).toContain('let anisoT');
      expect(src).toContain('let anisoB');
    });

    it('overrides the shared specularNormal slot with the bent normal (no IBL variant)', () => {
      expect(src).toMatch(/specularNormal = normalize\(mix\(/);
    });

    it('rotates the direction by the rotation param', () => {
      expect(src).toContain('material.anisotropyParams.y');
      expect(src).toContain('cos(anisoRot)');
      expect(src).toContain('sin(anisoRot)');
    });

    it('samples the anisotropy texture (texture variant)', () => {
      expect(src).toContain('sampleAnisotropy(input.vUV)');
    });
  });

  describe('WGSL factor-only variant', () => {
    const out = compileWgslSource({
      bits: [hostLighting, anisotropyBit],
      template: wgslTemplate,
    });
    const src = out.fragment.source;

    it('does not sample any anisotropy texture', () => {
      expect(src).not.toContain('sampleAnisotropy');
    });

    it('still evaluates the anisotropic GGX delta', () => {
      expect(src).toMatch(/directLight \+= \(anisoSpec - specular\)/);
    });
  });

  describe('GLSL composition with a host lighting bit', () => {
    const out = compileGlslSource({
      bits: [hostLighting, anisotropyTextureBit],
      template: glslTemplate,
    });
    const src = out.fragment;

    it('produces exactly one light loop (single shadow-sample path)', () => {
      const matches = src.match(/while \(lightMask != 0u\)/g) ?? [];
      expect(matches.length).toBe(1);
    });

    it('replaces the base specular with the anisotropic GGX delta inside the loop', () => {
      expect(src).toMatch(/directLight \+= \(anisoSpec - specular\) \* radiance \* nDotL \* shadow/);
    });

    it('guards its TBN helper with an ifndef so re-inclusion is safe', () => {
      expect(src).toContain('#ifndef PIXI3D_ANISOTROPY_TBN_DEFINED');
      expect(src).toContain('mat3 calculateAnisotropyTBN(');
    });

    it('overrides specularNormal with the bent normal and samples the anisotropy texture', () => {
      expect(src).toMatch(/specularNormal = normalize\(mix\(/);
      expect(src).toContain('sampleAnisotropy(vUV)');
    });
  });

  describe('GLSL factor-only variant', () => {
    const out = compileGlslSource({
      bits: [hostLighting, anisotropyBit],
      template: glslTemplate,
    });
    const src = out.fragment;

    it('does not sample any anisotropy texture', () => {
      expect(src).not.toContain('sampleAnisotropy');
    });
  });
});
