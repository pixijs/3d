import { BindGroup, RenderTexture, State, Texture, UniformGroup } from 'pixi.js';
import type { WebGPURenderer, WebGLRenderer } from 'pixi.js';

import { fullscreenTriangleGeometry } from '../fullscreenTriangleGeometry';
import { iblSamplingFuncsBit } from '../shader/bits/iblSamplingFuncsBit';
import type { ShaderBit } from '../shader/ShaderBit';
import type { ShaderBitTemplate } from '../shader/ShaderBitTemplate';
import { brdfLutGlslTemplate } from './brdfLutGlslTemplate';
import { brdfLutWgslTemplate } from './brdfLutWgslTemplate';

/** Both backends' LUT sources in one template; the material system compiles only its own */
const brdfLutTemplate: ShaderBitTemplate = {
  bindGroups: ['local'],
  gpu: brdfLutWgslTemplate.gpu,
  gl: brdfLutGlslTemplate.gl,
};

/**
 * Options for `generateBrdfLut`
 * @internal
 */
interface GenerateBrdfLutOptions {
  /** The renderer to generate with */
  renderer: WebGPURenderer | WebGLRenderer;
  /** Output texture size (width and height). Default: 256 */
  size?: number;
  /** Number of Monte Carlo samples per pixel. Default: 1024 */
  sampleCount?: number;
}

/**
 * Renders the BRDF lookup table that IBL specular lighting reads, following Karis's split sum
 *
 * UV x is `NdotV` and UV y is roughness. Each texel Monte Carlo integrates GGX for that pair into
 * the scale (red) and bias (green) the lighting shader applies to F0 before multiplying by the
 * prefiltered environment cube. The geometry term is Smith with Schlick-GGX at
 * `k = roughness² / 2`, the paper's choice for image-based lighting. `NdotV` is clamped to 0.001,
 * since the visibility term divides by it.
 *
 * The table is `rgba16float`: 8-bit storage bands visibly once tone mapping stretches a smooth
 * gradient, such as the shading across a sphere of one colour.
 *
 * Runs synchronously, and can run mid-frame on first use. It restores the caller's binding with
 * `getBindState` rather than `push` and `pop`: a 2D filter binds its input with `bind`, so `pop`
 * would land back on the screen and the caller's next draws would go there.
 * @param options - Renderer plus size/sample-count overrides.
 * @returns The generated rgba16float LUT texture.
 * @internal
 */
export function generateBrdfLut(options: GenerateBrdfLutOptions): Texture {
  const { renderer } = options;

  const size = options.size ?? 256;
  const sampleCount = options.sampleCount ?? 1024;

  const localBit: ShaderBit = {
    name: 'brdfLut',
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
    0: new UniformGroup({
      sampleCount: { value: sampleCount, type: 'f32' },
    }),
  });
  const shader = renderer.material3d.compileIsolatedShader([iblSamplingFuncsBit, localBit], brdfLutTemplate, {
    0: local,
  });

  const textureSource = RenderTexture.create({
    width: size,
    height: size,
    format: 'rgba16float',
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
