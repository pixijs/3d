import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * The one uniform both flipbook bits share: the sheet's grid as columns, rows
 * and frame count
 *
 * Frames are assumed to tile the sheet left to right, top to bottom, each cell
 * `1/columns` by `1/rows` of it. That is the one shape a uniform can describe;
 * a non-grid sheet can still pick a fixed frame per particle by writing
 * `aParticleUVFrame` at spawn.
 */
const GRID_BINDING = { uFlipbookGrid: 'vec3<f32>' } as const;

/** WGSL: the sampling window `(u0, v0, uScale, vScale)` of frame `frame` on the grid */
const WINDOW_WGSL = /*wgsl*/ `
    let cols = material.uFlipbookGrid.x;
    let rows = material.uFlipbookGrid.y;
    let col = frame % cols;
    let row = floor(frame / cols);
    let window = vec4<f32>(col / cols, row / rows, 1.0 / cols, 1.0 / rows);
    uv = window.xy + uv * window.zw;`;

/** GLSL counterpart of {@link WINDOW_WGSL} */
const WINDOW_GLSL = /*glsl*/ `
    float cols = material.uFlipbookGrid.x;
    float rows = material.uFlipbookGrid.y;
    float col = mod(frame, cols);
    float row = floor(frame / cols);
    vec4 window = vec4(col / cols, row / rows, 1.0 / cols, 1.0 / rows);
    uv = window.xy + uv * window.zw;`;

/**
 * Spreads the flipbook across a particle's lifetime: one pass, first frame
 * at birth, last frame at death
 *
 * Reads `particleProgress` from {@link particleLifetimeBit} and rewrites `uv`
 * from the corner id the particle bit kept, so the container is built with the
 * whole sheet as its one texture and carries no per-particle frame attribute.
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
 * Plays the flipbook at `uFrameRate` frames per second from birth, wrapping at
 * the last frame
 *
 * Reads `particleAge` from {@link particleLifetimeBit}. Same sheet contract as
 * {@link particleFlipbookOverLifeBit}.
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
