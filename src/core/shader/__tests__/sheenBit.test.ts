import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { createLightingBit } from '~/core/shader/createLightingBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { sheenBit } from '~/materials/pbr/bits/sheenBit';

/**
 * A minimal host lighting bit with `pbrLightingBit`'s contract for lobes: `nDotV` before the loop,
 * `halfVector` and `nDotH` inside it
 */
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

/**
 * The index of the `}` that closes the `{` at `openBraceIdx`, counting nested braces, so the close
 * of a lobe's inner `{ ... }` scope doesn't pass for the close of the loop
 */
function findMatchingClose(src: string, openBraceIdx: number): number {
  let depth = 0;
  for (let i = openBraceIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`Unmatched '{' at index ${openBraceIdx}`);
}

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

    it('produces exactly one light loop (single shadow-sample path)', () => {
      const matches = src.match(/for \(var n: i32 = 0;/g) ?? [];
      expect(matches.length).toBe(1);
    });

    it('places sheen setup before the loop, Charlie*Ashikhmin inside, composite after', () => {
      const setupIdx = src.indexOf('var sheenLight = vec3<f32>(0.0);');
      const perLightIdx = src.indexOf('sheenLight += sheenColor');
      const compositeIdx = src.indexOf('finalColor = finalColor * sheenAlbedoScale');
      const loopOpenIdx = src.indexOf('for (var n: i32 = 0;');
      const loopOpenBraceIdx = src.indexOf('{', loopOpenIdx);
      const loopCloseIdx = findMatchingClose(src, loopOpenBraceIdx);

      expect(setupIdx).toBeLessThan(loopOpenIdx);
      expect(perLightIdx).toBeGreaterThan(loopOpenIdx);
      expect(perLightIdx).toBeLessThan(loopCloseIdx);
      expect(compositeIdx).toBeGreaterThan(loopCloseIdx);
    });

    it("reuses the host's halfVector and nDotH instead of computing its own", () => {
      const normalizes = src.match(/normalize\s*\(\s*viewDir\s*\+\s*lightDir\s*\)/g) ?? [];
      expect(normalizes.length).toBe(1);
      expect(src).not.toMatch(/let\s+shH\s*=/);
      expect(src).not.toMatch(/let\s+shNdotH\s*=/);
    });

    it('hoists the light-independent Charlie factors, (2 + 1/α) / 2π and 1 / 2α, out of charlieD', () => {
      expect(src).toContain('let sheenInvAlpha');
      expect(src).toContain('let sheenCharlieScale');
      expect(src).toContain('charlieD(sheenCharlieScale, sheenInvAlphaHalf, nDotH)');
      expect(src).not.toMatch(/fn charlieD[^)]*\)\s*->\s*f32\s*\{[^}]*1\.0\s*\/\s*sheenAlpha/);
    });

    it('hoists the largest sheen colour channel into sheenMax for the composite to read', () => {
      expect(src).toContain('let sheenMax');
      expect(src).toMatch(/sheenAlbedoScale\s*=\s*1\.0\s*-\s*sheenMax\s*\*\s*shE/);
    });

    it("undoes pixi's premultiplied upload before sRGB-decoding the colour, since alpha holds roughness", () => {
      expect(src).toMatch(/sheenTex\.rgb\s*\/\s*max\s*\(\s*sheenTex\.a/);
      expect(src).toMatch(/pow\(sheenTexStraight,\s*vec3(?:<f32>)?\(2\.2\)\)/);
    });

    it('gives the environment lookup and sheenE the raw roughness, and floors it only for direct Charlie', () => {
      expect(src).toContain('let sheenRoughnessIBL');
      expect(src).toContain('sampleEnvironment(shR, sheenRoughnessIBL)');
      expect(src).toContain('sheenE(nDotV, sheenRoughnessIBL)');
      expect(src).toMatch(/let sheenRoughness\s*=\s*max\s*\(\s*sheenRoughnessIBL/);
    });

    it('dims the base layer by sheenAlbedoScale, then adds the direct and environment sheen', () => {
      expect(src).toMatch(/finalColor = finalColor \* sheenAlbedoScale \+ sheenLight \+ sheenIBL/);
    });

    it('does not scale the environment sheen by occlusion, which shadows only the base under the fibres', () => {
      expect(src).not.toMatch(/sheenIBL\s*\*\s*occlusion/);
    });

    it('samples the environment through sampleEnvironment, so any environment source works', () => {
      expect(src).toContain('reflect(-viewDir, normal)');
      expect(src).toContain('sampleEnvironment(shR, sheenRoughnessIBL)');
    });
  });

  describe('GLSL composition with a host lighting bit', () => {
    const out = compileGlslSource({
      bits: [hostLighting, sheenBit],
      template: glslTemplate,
    });
    const src = out.fragment;

    it('produces exactly one light loop (single shadow-sample path)', () => {
      const matches = src.match(/for \(int n = 0;/g) ?? [];
      expect(matches.length).toBe(1);
    });

    it('places sheen setup before the loop, Charlie*Ashikhmin inside, composite after', () => {
      const setupIdx = src.indexOf('vec3 sheenLight = vec3(0.0);');
      const perLightIdx = src.indexOf('sheenLight += sheenColor');
      const compositeIdx = src.indexOf('finalColor = finalColor * sheenAlbedoScale');
      const loopOpenIdx = src.indexOf('for (int n = 0;');
      const loopOpenBraceIdx = src.indexOf('{', loopOpenIdx);
      const loopCloseIdx = findMatchingClose(src, loopOpenBraceIdx);

      expect(setupIdx).toBeLessThan(loopOpenIdx);
      expect(perLightIdx).toBeGreaterThan(loopOpenIdx);
      expect(perLightIdx).toBeLessThan(loopCloseIdx);
      expect(compositeIdx).toBeGreaterThan(loopCloseIdx);
    });

    it("reuses the host's halfVector and nDotH instead of computing its own", () => {
      const normalizes = src.match(/normalize\s*\(\s*viewDir\s*\+\s*lightDir\s*\)/g) ?? [];
      expect(normalizes.length).toBe(1);
      expect(src).not.toMatch(/vec3\s+shH\s*=/);
      expect(src).not.toMatch(/float\s+shNdotH\s*=/);
    });

    it('hoists Charlie constants and sheenMax out of the per-light path', () => {
      expect(src).toContain('float sheenInvAlpha');
      expect(src).toContain('float sheenCharlieScale');
      expect(src).toContain('charlieD(sheenCharlieScale, sheenInvAlphaHalf, nDotH)');
      expect(src).toContain('float sheenMax');
      expect(src).toMatch(/sheenAlbedoScale\s*=\s*1\.0\s*-\s*sheenMax\s*\*\s*shE/);
    });

    it('samples the environment through sampleEnvironment, so any environment source works', () => {
      expect(src).toContain('reflect(-viewDir, normal)');
      expect(src).toContain('sampleEnvironment(shR, sheenRoughnessIBL)');
    });

    it("undoes pixi's premultiplied upload before sRGB-decoding the colour, since alpha holds roughness", () => {
      expect(src).toMatch(/sheenTex\.rgb\s*\/\s*max\s*\(\s*sheenTex\.a/);
      expect(src).toMatch(/pow\(sheenTexStraight,\s*vec3(?:<f32>)?\(2\.2\)\)/);
    });

    it('gives the environment lookup and sheenE the raw roughness, and floors it only for direct Charlie', () => {
      expect(src).toContain('float sheenRoughnessIBL');
      expect(src).toContain('sampleEnvironment(shR, sheenRoughnessIBL)');
      expect(src).toContain('sheenE(nDotV, sheenRoughnessIBL)');
      expect(src).toMatch(/float sheenRoughness\s*=\s*max\s*\(\s*sheenRoughnessIBL/);
    });

    it('does not scale the environment sheen by occlusion', () => {
      expect(src).not.toMatch(/sheenIBL\s*\*\s*occlusion/);
    });
  });
});
