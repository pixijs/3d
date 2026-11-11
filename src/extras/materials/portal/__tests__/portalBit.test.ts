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

    it('never scales the UV by uViewportUVScale in its helper, since a feed is bound whole', () => {
      const helper = src.slice(src.indexOf('fn portalScreenUV'), src.indexOf('}', src.indexOf('fn portalScreenUV')));
      expect(helper).not.toContain('uViewportUVScale');
    });
  });

  describe('GLSL', () => {
    const out = compileGlslSource({ bits: [cameraBit, portalBit], template: glslTemplate });

    it('never scales the UV by uViewportUVScale in its helper, since a feed is bound whole', () => {
      const start = out.fragment.indexOf('vec2 portalScreenUV');
      const helper = out.fragment.slice(start, out.fragment.indexOf('}', start));
      expect(helper).not.toContain('uViewportUVScale');
    });
  });
});
