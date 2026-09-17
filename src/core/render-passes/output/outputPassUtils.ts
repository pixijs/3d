import { Geometry, State } from 'pixi.js';

import type { ShaderBit } from '../../shader/ShaderBit';

/**
 * ShaderBit for the output (present) pass: the scene-colour texture + sampler it blits
 * to the screen
 *
 * Shared between the WebGPU and WebGL output passes — the header generates the matching
 * WGSL/GLSL binding declarations.
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
 * GLSL templates for the output pass (the WGSL counterpart lives on the pass)
 *
 * Y-orientation: a WebGL render target samples bottom-left-origin, so the
 * clip-space-derived UV maps straight through here; the WGSL path flips Y for
 * WebGPU's top-left texture origin. Verify against a rendered inset View.
 * @internal
 */
export const outputGlTemplate = {
  vertex: /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArrayShadow;

{{header}}

void main() {
  // The scene fills only the [0, vp] sub-rect of its pooled power-of-two texture;
  // scale the [0,1] blit UV onto that sub-rect (uViewportUVScale is 1 full-screen).
  vUv = (aPosition * 0.5 + 0.5) * uViewportUVScale;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`,
  fragment: /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArrayShadow;

{{header}}

out vec4 fragColor;

void main() {
  fragColor = texture(uTexture, vUv);
}
`,
};

/**
 * Creates the fullscreen triangle (one primitive, no seam) covering clip space [-1, 1]^2
 *
 * The executor binds the View's screen rect as the viewport, clipping the triangle to
 * it; the UV samples the whole scene transient onto that rect.
 * @returns The fullscreen-triangle geometry
 * @internal
 */
export function createOutputGeometry(): Geometry {
  return new Geometry({
    attributes: {
      aPosition: [-1, -1, 3, -1, -1, 3],
    },
  });
}

/**
 * Creates the output state: composite the scene over whatever the View sits on (2D
 * content, for an inset), with no depth interaction
 *
 * Premultiplied-alpha `blend` lets a transparent-background View show the 2D
 * underneath; an opaque scene (alpha 1) fills regardless.
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
