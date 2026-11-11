import type { ShaderBit } from '../../../core/shader/ShaderBit';

const GRID_BINDING = { uFlipbookGrid: 'vec3<f32>' } as const;

const WINDOW_WGSL = /*wgsl*/ `
    let cols = material.uFlipbookGrid.x;
    let rows = material.uFlipbookGrid.y;
    let col = frame % cols;
    let row = floor(frame / cols);
    let window = vec4<f32>(col / cols, row / rows, 1.0 / cols, 1.0 / rows);
    uv = window.xy + uv * window.zw;`;

const WINDOW_GLSL = /*glsl*/ `
    float cols = material.uFlipbookGrid.x;
    float rows = material.uFlipbookGrid.y;
    float col = mod(frame, cols);
    float row = floor(frame / cols);
    vec4 window = vec4(col / cols, row / rows, 1.0 / cols, 1.0 / rows);
    uv = window.xy + uv * window.zw;`;

/**
 * Plays the flipbook once over a particle's life, first frame at birth and last at death
 *
 * Give the container the whole sheet as its one texture, not an array of frames, and set its
 * `uFlipbookGrid` uniform to `[columns, rows, frameCount]`. Frames run left to right, then top to
 * bottom, in equal cells. Compose it after {@link particleLifetimeBit}.
 * @category scene
 * @advanced
 */
export const particleFlipbookOverLifeBit = {
  name: 'particleFlipbookOverLife',

  bindings: { material: GRID_BINDING },

  gpu: {
    vertex: {
      beforeTransform: /*wgsl*/ `
  {
    let count = material.uFlipbookGrid.z;
    let frame = min(floor(particleProgress * count), count - 1.0);
${WINDOW_WGSL}
  }
`,
    },
  },

  gl: {
    vertex: {
      beforeTransform: /*glsl*/ `
  {
    float count = material.uFlipbookGrid.z;
    float frame = min(floor(particleProgress * count), count - 1.0);
${WINDOW_GLSL}
  }
`,
    },
  },
} satisfies ShaderBit;

/**
 * Plays the flipbook at `uFrameRate` frames per second from birth, looping
 *
 * Set up the sheet as for {@link particleFlipbookOverLifeBit}, and compose it after
 * {@link particleLifetimeBit}.
 * @category scene
 * @advanced
 */
export const particleFlipbookRateBit = {
  name: 'particleFlipbookRate',

  bindings: {
    material: {
      ...GRID_BINDING,
      uFrameRate: 'f32',
    },
  },

  gpu: {
    vertex: {
      beforeTransform: /*wgsl*/ `
  {
    let count = material.uFlipbookGrid.z;
    let frame = floor(particleAge * material.uFrameRate) % count;
${WINDOW_WGSL}
  }
`,
    },
  },

  gl: {
    vertex: {
      beforeTransform: /*glsl*/ `
  {
    float count = material.uFlipbookGrid.z;
    float frame = mod(floor(particleAge * material.uFrameRate), count);
${WINDOW_GLSL}
  }
`,
    },
  },
} satisfies ShaderBit;
