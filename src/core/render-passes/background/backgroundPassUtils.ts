import { Geometry, State } from 'pixi.js';

import type { ShaderBit } from '../../shader/ShaderBit';

/**
 * ShaderBit defining the background-specific bindings (cubemap texture + sampler)
 *
 * Shared between the WebGPU and WebGL background passes.
 * @internal
 */
export const backgroundBit: ShaderBit = {
  name: 'background',
  attributes: {
    aPosition: 'float32x3',
  },
  interStage: {
    vDir: 'vec3<f32>',
  },
  bindings: {
    background: {
      uCube: 'texture_cube<f32>',
      uCubeSampler: 'sampler',
    },
  },
};

/**
 * Shared GLSL vertex/fragment templates for the background (skybox) pass
 *
 * The WGSL template is only used by the WebGPU pass and defined there.
 * @internal
 */
export const backgroundGlTemplate = {
  vertex: /* glsl */ `#version 300 es

{{header}}

void main() {
  // aPosition is already a world-space direction for the skybox cube.
  // Rotating the lookup direction again with camera rotation would over-rotate.
  vDir = aPosition;

  // Remove translation from the view so the skybox stays "infinitely far".
  mat4 view = uViewMatrix;
  view[3].xyz = vec3(0.0);

  vec4 clip = uProjectionMatrix * view * vec4(aPosition, 1.0);
  gl_Position = clip.xyww; // force depth to far plane
}
`,
  fragment: /* glsl */ `#version 300 es

{{header}}

out vec4 fragColor;

void main() {
  vec4 sampleColor = texture(uCube, normalize(vDir));
  // Gamma 2.2 sRGB decode — see WGSL counterpart for rationale.
  vec3 sampleLinear = pow(sampleColor.rgb, vec3(2.2));
  vec3 finalColor = sampleLinear * uExposure;
  {{end}}
  fragColor = vec4(finalColor, sampleColor.a);
}
`,
};

/**
 * Creates the skybox cube geometry
 *
 * 36 vertices (6 faces * 2 triangles * 3 verts), position doubles as direction.
 * Cube is centered at origin (camera), translation removed from view in shader.
 * @returns The skybox cube geometry
 * @internal
 */
export function createBackgroundGeometry(): Geometry {
  const s = 1;

  const positions: number[] = [];

  const pushFace = (corners: number[][]) => {
    // two triangles: 0-1-2, 0-2-3
    const idx = [0, 1, 2, 0, 2, 3];
    for (let i = 0; i < idx.length; i++) {
      const c = corners[idx[i]];
      positions.push(c[0], c[1], c[2]);
    }
  };

  // +X
  pushFace([
    [s, -s, -s],
    [s, -s, s],
    [s, s, s],
    [s, s, -s],
  ]);
  // -X
  pushFace([
    [-s, -s, s],
    [-s, -s, -s],
    [-s, s, -s],
    [-s, s, s],
  ]);
  // +Y
  pushFace([
    [-s, s, -s],
    [s, s, -s],
    [s, s, s],
    [-s, s, s],
  ]);
  // -Y
  pushFace([
    [-s, -s, s],
    [s, -s, s],
    [s, -s, -s],
    [-s, -s, -s],
  ]);
  // +Z
  pushFace([
    [-s, -s, s],
    [-s, s, s],
    [s, s, s],
    [s, -s, s],
  ]);
  // -Z
  pushFace([
    [s, -s, -s],
    [s, s, -s],
    [-s, s, -s],
    [-s, -s, -s],
  ]);

  return new Geometry({
    attributes: {
      aPosition: positions,
    },
  });
}

/**
 * Creates the render state for the background pass
 *
 * Background: draw first, no depth write, no culling.
 * @returns The background render state
 * @internal
 */
export function createBackgroundState(): State {
  const state = new State();

  state.depthTest = false;
  state.depthMask = false;
  state.culling = false;
  state.blend = false;

  return state;
}
