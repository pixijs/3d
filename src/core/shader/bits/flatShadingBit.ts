import type { ShaderBit } from '../ShaderBit';

/**
 * The derivative normal's sign follows screen handedness, so it's flipped to agree with `normal`
 * @internal
 */
export const flatShadingBit: ShaderBit = {
  name: 'flatShading',

  gpu: {
    fragment: {
      material: /*wgsl*/ `
  let flatNormal = normalize(cross(dpdx(input.vPosition), dpdy(input.vPosition)));
  normal = select(-flatNormal, flatNormal, dot(flatNormal, normal) >= 0.0);
`,
    },
  },

  gl: {
    fragment: {
      material: /*glsl*/ `
  vec3 flatNormal = normalize(cross(dFdx(vPosition), dFdy(vPosition)));
  normal = dot(flatNormal, normal) >= 0.0 ? flatNormal : -flatNormal;
`,
    },
  },
};
