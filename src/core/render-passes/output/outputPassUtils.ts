import { State } from 'pixi.js';

import type { ShaderBit } from '../../shader/ShaderBit';

/**
 * The output blit's shader bit: the triangle's position input, its UV varying, and the scene
 * colour texture with its sampler, the same on both backends
 * @internal
 */
export const outputBit: ShaderBit = {
  name: 'output',
  attributes: {
    aPosition: 'float32x2',
  },
  interStage: {
    vUv: 'vec2<f32>',
  },
  bindings: {
    output: {
      uTexture: 'texture_2d<f32>',
      uTextureSampler: 'sampler',
    },
  },
};

/**
 * GLSL half of the output blit's shader template
 *
 * `outputTemplate` in `OutputPass.ts` holds the WGSL half and documents what both do.
 * @internal
 */
export const outputGlTemplate = {
  vertex: /* glsl */ `#version 300 es

{{header}}

void main() {
  vUv = (aPosition * 0.5 + 0.5) * uViewportUVScale;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`,
  fragment: /* glsl */ `#version 300 es

{{header}}

out vec4 fragColor;

void main() {
  fragColor = texture(uTexture, vUv);
}
`,
};

/**
 * Creates the output blit's render state: blended over whatever the view sits on, with no depth
 * test or write and no culling
 *
 * pixi's default blend is for premultiplied alpha, so a view with a transparent background shows
 * the 2D content beneath it, and an opaque scene covers it.
 * @returns The output-blit render state
 * @internal
 */
export function createOutputState(): State {
  const state = new State();

  state.depthTest = false;
  state.depthMask = false;
  state.culling = false;
  state.blend = true;

  return state;
}
