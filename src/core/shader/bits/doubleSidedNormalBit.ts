import type { ShaderBit } from '../ShaderBit';

/** @internal */
export const doubleSidedNormalBit: ShaderBit = {
  name: 'doubleSidedNormal',
  gpu: {
    fragment: {
      material: /*wgsl*/ `
  normal = select(-normal, normal, input.frontFacing);
`,
    },
  },
  gl: {
    fragment: {
      material: /*glsl*/ `
  if (!gl_FrontFacing) {
    normal = -normal;
  }
`,
    },
  },
};
