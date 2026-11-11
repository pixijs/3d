import { Geometry, State } from 'pixi.js';

import type { ShaderBit } from '../../shader/ShaderBit';

/**
 * The cube sky's shader bit, the same on both backends
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
 * The gradient sky's shader bit; its own uniforms, since the global `uHemisphere*` ones hold valid
 * data only while the view's environment is a hemisphere
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

/** GLSL twin of `backgroundVertexWgsl` in `BackgroundPass.ts` */
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
 * GLSL half of `backgroundTemplate` in `BackgroundPass.ts`
 * @internal
 */
export const backgroundGlTemplate = {
  vertex: backgroundVertexGl,
  fragment: /* glsl */ `#version 300 es

{{header}}

out vec4 fragColor;

void main() {
  vec4 sampleColor = texture(uCube, normalize(vDir));
  vec3 sampleLinear = decodeToLinear(sampleColor.rgb);
  vec3 finalColor = sampleLinear * uExposure;
  {{end}}
  fragColor = vec4(finalColor, sampleColor.a);
}
`,
};

/**
 * GLSL half of `backgroundGradientTemplate` in `BackgroundPass.ts`
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
 * The sky cube, whose vertex positions are the directions the shader looks the cubemap up in
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

/** @internal */
export function createBackgroundState(): State {
  const state = new State();

  state.depthTest = false;
  state.depthMask = false;
  state.culling = false;
  state.blend = false;

  return state;
}
