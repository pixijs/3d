import { BindGroup, RenderTexture, State, Texture, UniformGroup } from 'pixi.js';
import type { WebGPURenderer, WebGLRenderer } from 'pixi.js';

import { fullscreenTriangleGeometry } from '../fullscreenTriangleGeometry';
import { iblSamplingFuncsBit } from '../shader/bits/iblSamplingFuncsBit';
import type { ShaderBit } from '../shader/ShaderBit';
import type { ShaderBitTemplate } from '../shader/ShaderBitTemplate';
import { brdfLutGlslTemplate } from './brdfLutGlslTemplate';
import { brdfLutWgslTemplate } from './brdfLutWgslTemplate';

const brdfLutTemplate: ShaderBitTemplate = {
  bindGroups: ['local'],
  gpu: brdfLutWgslTemplate.gpu,
  gl: brdfLutGlslTemplate.gl,
};

interface GenerateBrdfLutOptions {
  renderer: WebGPURenderer | WebGLRenderer;
  size?: number;
  sampleCount?: number;
}

/**
 * Renders the split-sum BRDF table IBL reads, in `rg16float` since 8 bits band visibly once tone-mapped; it restores
 * the caller's bind with `getBindState`, not `pop`, which inside a 2D filter would land on the screen
 * @internal
 */
export function generateBrdfLut(options: GenerateBrdfLutOptions): Texture {
  const { renderer } = options;

  const size = options.size ?? 256;
  const sampleCount = options.sampleCount ?? 1024;

  const localBit: ShaderBit = {
    name: 'brdfLut',
    requires: [iblSamplingFuncsBit],
    attributes: {
      aPosition: 'float32x2',
    },
    interStage: {
      vUv: 'vec2<f32>',
    },
    bindings: {
      local: {
        sampleCount: 'f32',
      },
    },
  };

  const local = new BindGroup({
    local: new UniformGroup({
      sampleCount: { value: sampleCount, type: 'f32' },
    }),
  });
  const shader = renderer.material3d.compileIsolatedShader([localBit], brdfLutTemplate, {
    0: local,
  });

  const textureSource = RenderTexture.create({
    width: size,
    height: size,
    format: 'rg16float',
  }).source;

  const texture = new Texture({
    source: textureSource,
  });

  const geometry = fullscreenTriangleGeometry();

  const savedBind = renderer.renderTarget.renderTarget ? renderer.renderTarget.getBindState() : null;

  renderer.renderTarget.bind({ target: textureSource, clear: true });

  renderer.encoder.draw({
    geometry,
    shader,
    state: State.default2d,
  });

  if (savedBind) renderer.renderTarget.bind(savedBind);

  local.destroy();
  shader.destroy();

  return texture;
}
