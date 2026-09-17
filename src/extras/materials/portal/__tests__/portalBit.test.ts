import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { cameraBit } from '~/core/shader/bits/cameraBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { portalBit } from '~/extras/materials/portal/portalBit';

/**
 * The portal surface samples its feed at the fragment's own screen position, so two things have
 * to hold in the generated source or the far side drifts as the viewer moves:
 *
 *   1. the UV comes from the clip position (`uViewProjectionMatrix`), not the mesh's own UVs;
 *   2. Y is flipped on *both* backends — see `portalBit`'s note on why one expression serves two
 *      opposite conventions. The GLSL half is the surprising one, and the easy thing for a later
 *      edit to "fix" into agreement with `screenSpaceFuncsBit`, which doesn't flip.
 *
 * Plus: no `uViewportUVScale` in the helper, because a feed is drawn into an explicitly sized
 * transient bound whole and copied texel for texel, not a pooled transient holding its content in
 * a corner.
 */

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

describe('portalBit', () => {
  describe('metadata', () => {
    it('declares one texture slot, named for the feed it shows', () => {
      expect(portalBit.textures).toEqual(['portal']);
    });

    it('packs only a tint into the material struct', () => {
      expect(portalBit.bindings?.material).toEqual({ baseColor: 'vec4<f32>' });
    });
  });

  describe('WGSL', () => {
    const out = compileWgslSource({ bits: [cameraBit, portalBit], template: wgslTemplate });
    const src = out.fragment.source;

    it('builds the UV from the clip position against the camera group', () => {
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

    it('does not scale the UV onto a pooled sub-rect', () => {
      // The camera group declares the lane for everyone; what matters is that the helper never
      // multiplies by it.
      const helper = src.slice(src.indexOf('fn portalScreenUV'), src.indexOf('}', src.indexOf('fn portalScreenUV')));
      expect(helper).not.toContain('uViewportUVScale');
    });

    it('declares the camera group the helper reads', () => {
      expect(out.structs.Camera).toMatchObject({ uViewProjectionMatrix: 'mat4x4<f32>' });
    });
  });

  describe('GLSL', () => {
    const out = compileGlslSource({ bits: [cameraBit, portalBit], template: glslTemplate });

    it('builds the UV from the clip position, with the flat uniform name', () => {
      expect(out.fragment).toContain('vec2 portalScreenUV(vec3 worldPos)');
      expect(out.fragment).toContain('uViewProjectionMatrix * vec4(worldPos, 1.0)');
    });

    it('flips Y as well — a feed is a non-root FBO, so its rows run against the screen', () => {
      expect(out.fragment).toMatch(/vec2\(ndc\.x \* 0\.5 \+ 0\.5, 1\.0 - \(ndc\.y \* 0\.5 \+ 0\.5\)\)/);
    });

    it('samples the feed at the interpolated world position', () => {
      expect(out.fragment).toContain('samplePortal(portalScreenUV(vPosition))');
    });

    it('does not scale the UV onto a pooled sub-rect', () => {
      const start = out.fragment.indexOf('vec2 portalScreenUV');
      const helper = out.fragment.slice(start, out.fragment.indexOf('}', start));
      expect(helper).not.toContain('uViewportUVScale');
    });

    it('puts the helper in the vertex stage too, where the shared header also lands', () => {
      // A GL `header` is emitted into both stages, so it has to compile in both: the helper reads
      // only the camera uniform, never `material`, which the vertex stage has no access to.
      expect(out.vertex).toContain('vec2 portalScreenUV(vec3 worldPos)');
      expect(out.vertex).not.toContain('material.');
    });
  });
});
