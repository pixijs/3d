import { BindGroup, Geometry, RenderTexture, State, Texture, UniformGroup } from 'pixi.js';
import type { WebGPURenderer, WebGLRenderer } from 'pixi.js';

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
 * Renders the Karis split-sum BRDF integration LUT used by IBL specular lighting
 *
 * UV x = NdotV, UV y = roughness; each texel holds the scale/bias pair the
 * lighting shader combines with the prefiltered environment cube. Runs
 * synchronously on the given renderer and restores the caller's render-target
 * binding afterwards.
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

  // 16-bit float storage is required to avoid contour banding from 8-bit
  // quantization of the BRDF integration result. The Karis split-sum LUT
  // values are <= ~1.04 and tone-mapping amplifies any per-code steps into
  // visible bands on smooth gradients (uniform-coloured spheres are the
  // canonical failure case). RG channels would suffice (the LUT shader writes
  // only red/green) but rgba16float has wider renderable-format coverage
  // across WebGPU adapters.
  const textureSource = RenderTexture.create({
    width: size,
    height: size,
    format: 'rgba16float',
  }).source;

  const texture = new Texture({
    source: textureSource,
  });

  const geometry = new Geometry({
    attributes: {
      aPosition: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    },
    topology: 'triangle-strip',
  });

  // Capture the caller's live binding and replay it after drawing, rather than
  // push/pop: pop() restores the render-target stack's top, but a 2D filter binds
  // its input texture off the stack (FilterSystem uses bind, not push), so pop()
  // would snap back to the screen and the caller's subsequent draws would land there.
  // This runs lazily mid-frame (first use), so the restore must carry every bind
  // axis (frame, orientation, subresource) — the capture replays non-destructively.
  // Null when nothing is bound yet (a standalone call outside a render).
  const savedBind = renderer.renderTarget.renderTarget ? renderer.renderTarget.getBindState() : null;

  renderer.renderTarget.bind({ target: textureSource, clear: true });

  renderer.encoder.draw({
    geometry,
    shader,
    state: State.default2d,
  });

  if (savedBind) renderer.renderTarget.bind(savedBind);

  return texture;
}
