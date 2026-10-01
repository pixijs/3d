import { Geometry, State } from 'pixi.js';

import type { ShaderBit } from '../../shader/ShaderBit';

/**
 * The sky's own shader bit: the cube position input, the look-up direction it passes to the
 * fragment, and the cubemap with its sampler, the same on both backends
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
 * ShaderBit defining the gradient background's bindings: the {@link Hemisphere}'s linear sky and
 * ground colours and its unit up axis
 *
 * Same attributes and inter-stage as {@link backgroundBit}. Only the `background` group differs.
 * That group holds the pass's own uniforms. The shader does not read the global `uHemisphere*`
 * ones, because they hold valid data only while the view's environment is a hemisphere.
 * @internal
 */
export const backgroundGradientBit: ShaderBit = {
  name: 'backgroundGradient',
  attributes: {
    aPosition: 'float32x3',
  },
  interStage: {
    vDir: 'vec3<f32>',
  },
  bindings: {
    background: {
      uSkyColor: 'vec3<f32>',
      uGroundColor: 'vec3<f32>',
      uUp: 'vec3<f32>',
    },
  },
};

/** GLSL vertex stage shared by the cube and gradient templates; `backgroundVertexWgsl` documents both */
const backgroundVertexGl = /* glsl */ `#version 300 es

{{header}}

void main() {
  vDir = aPosition;

  mat4 view = uViewMatrix;
  view[3].xyz = vec3(0.0);

  vec4 clip = uProjectionMatrix * view * vec4(aPosition, 1.0);
  gl_Position = clip.xyww;
}
`;

/**
 * GLSL half of the cube sky's shader template
 *
 * `backgroundTemplate` in `BackgroundPass.ts` holds the WGSL half and documents what both do.
 * @internal
 */
export const backgroundGlTemplate = {
  vertex: backgroundVertexGl,
  fragment: /* glsl */ `#version 300 es

{{header}}

out vec4 fragColor;

void main() {
  vec4 sampleColor = texture(uCube, normalize(vDir));
  vec3 sampleLinear = pow(sampleColor.rgb, vec3(2.2));
  vec3 finalColor = sampleLinear * uExposure;
  {{end}}
  fragColor = vec4(finalColor, sampleColor.a);
}
`,
};

/**
 * GLSL vertex/fragment templates for the {@link Hemisphere} gradient background
 *
 * Shares the cube template's vertex stage. `backgroundGradientTemplate` in `BackgroundPass.ts`
 * holds the WGSL half.
 * @internal
 */
export const backgroundGradientGlTemplate = {
  vertex: backgroundVertexGl,
  fragment: /* glsl */ `#version 300 es

{{header}}

out vec4 fragColor;

void main() {
  float t = dot(normalize(vDir), uUp) * 0.5 + 0.5;
  vec3 finalColor = mix(uGroundColor, uSkyColor, t) * uExposure;
  {{end}}
  fragColor = vec4(finalColor, 1.0);
}
`,
};

/**
 * Creates the sky cube: 36 unindexed vertices around the origin, whose positions double as the
 * directions the shader looks the cubemap up in
 * @returns The sky cube geometry
 * @internal
 */
export function createBackgroundGeometry(): Geometry {
  const s = 1;

  const positions: number[] = [];

  const pushFace = (corners: number[][]) => {
    const idx = [0, 1, 2, 0, 2, 3];
    for (let i = 0; i < idx.length; i++) {
      const c = corners[idx[i]];
      positions.push(c[0], c[1], c[2]);
    }
  };

  pushFace([
    [s, -s, -s],
    [s, -s, s],
    [s, s, s],
    [s, s, -s],
  ]);
  pushFace([
    [-s, -s, s],
    [-s, -s, -s],
    [-s, s, -s],
    [-s, s, s],
  ]);
  pushFace([
    [-s, s, -s],
    [s, s, -s],
    [s, s, s],
    [-s, s, s],
  ]);
  pushFace([
    [-s, -s, s],
    [s, -s, s],
    [s, -s, -s],
    [-s, -s, -s],
  ]);
  pushFace([
    [-s, -s, s],
    [-s, s, s],
    [s, s, s],
    [s, -s, s],
  ]);
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
 * Creates the sky's render state: no depth test or write, no culling and no blending, so the sky
 * paints over whatever its target already holds
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
