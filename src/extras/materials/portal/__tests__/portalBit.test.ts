import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { cameraBit } from '~/core/shader/bits/cameraBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { portalBit } from '~/extras/materials/portal/portalBit';

const wgslTemplate: ShaderBitTemplate = {
  bindGroups: ['global', 'camera', 'batch'],
  gpu: '{{header}}\n{{fragmentMaterial}}',
};

const glslTemplate: ShaderBitTemplate = {
  bindGroups: ['global', 'camera', 'batch'],
  gl: {
    vertex: '{{header}}\nvoid main() {}',
    fragment: '{{header}}\nvoid main() { {{material}} }',
  },
};

describe('portalBit samples its feed at the fragment screen position, so the far side holds still as the viewer moves', () => {
  describe('WGSL', () => {
    const out = compileWgslSource({ bits: [cameraBit, portalBit], template: wgslTemplate });
    const src = out.fragment.source;

    it('builds the UV from the clip position against the camera group, not from the mesh UVs', () => {
      expect(src).toContain('fn portalScreenUV(worldPos: vec3<f32>) -> vec2<f32>');
      expect(src).toContain('camera.uViewProjectionMatrix * vec4<f32>(worldPos, 1.0)');
      expect(src).toContain('let ndc = clip.xy / clip.w;');
    });

    it('flips Y for the texture origin', () => {
      expect(src).toMatch(/vec2<f32>\(ndc\.x \* 0\.5 \+ 0\.5, 1\.0 - \(ndc\.y \* 0\.5 \+ 0\.5\)\)/);
    });

    it('samples the feed at the fragment world position, through the generated slot helper', () => {
      expect(src).toContain('samplePortal(portalScreenUV(input.vPosition))');
    });

    it('never scales the UV by uViewportUVScale in its helper, since a feed is bound whole', () => {
      const helper = src.slice(src.indexOf('fn portalScreenUV'), src.indexOf('}', src.indexOf('fn portalScreenUV')));
      expect(helper).not.toContain('uViewportUVScale');
    });

    it('declares the camera group the helper reads', () => {
      expect(out.structs.Camera).toMatchObject({ uViewProjectionMatrix: 'mat4x4<f32>' });
    });
  });

  describe('GLSL', () => {
    const out = compileGlslSource({ bits: [cameraBit, portalBit], template: glslTemplate });

    it('flips Y as well, unlike screenSpaceFuncsBit: a feed is a non-root framebuffer, so its rows run against the screen', () => {
      expect(out.fragment).toMatch(/vec2\(ndc\.x \* 0\.5 \+ 0\.5, 1\.0 - \(ndc\.y \* 0\.5 \+ 0\.5\)\)/);
    });

    it('never scales the UV by uViewportUVScale in its helper, since a feed is bound whole', () => {
      const start = out.fragment.indexOf('vec2 portalScreenUV');
      const helper = out.fragment.slice(start, out.fragment.indexOf('}', start));
      expect(helper).not.toContain('uViewportUVScale');
    });
  });
});
