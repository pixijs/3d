import type { ShaderBit } from '../ShaderBit';

/**
 * Replaces the interpolated normal with the triangle's face normal, for
 * {@link BaseMaterial3DOptions.flatShading}
 *
 * It takes the face normal from the screen-space derivatives of the world position, so it needs
 * no extra attributes or split vertices: the same geometry draws smooth or faceted by material
 * alone.
 *
 * The derivatives' cross product points one way or the other depending on screen handedness, so it
 * is flipped to agree with the incoming `normal`. Back faces and mirrored transforms then light as
 * the smooth normal would, and the double-sided flip before it still works.
 *
 * The renderer adds it after the double-sided flip and before normal mapping, so a normal map bends
 * the face normal rather than being replaced by it. The template declares `normal`, so that
 * position is the same for every material, which is why the option is on {@link BaseMaterial3D}.
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
