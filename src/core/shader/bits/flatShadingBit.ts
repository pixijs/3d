import type { ShaderBit } from '../ShaderBit';

/**
 * Replaces the interpolated shading normal with the triangle's face normal
 *
 * Derived per-fragment from screen-space derivatives of world position, so it
 * needs no extra attributes and no duplicated vertices — the same geometry
 * renders smooth or faceted purely by material choice. This is what gives
 * low-poly scenes their hard-edged look.
 *
 * The face normal's winding sign depends on screen-space handedness, so it is
 * aligned against the incoming `normal`. That keeps back faces and mirrored
 * (negative-determinant) transforms lit the way the smooth path would light
 * them, and lets `doubleSidedNormalBit` keep working unchanged.
 *
 * The material system injects this after `doubleSidedNormalBit` and before
 * normal mapping, so a normal map perturbs the face normal rather than being
 * overwritten by it. `normal` is declared by the shader template rather than by
 * any material's own bits, so that insertion point is the same for every
 * material — which is why the flag lives on {@link BaseMaterial3D} rather than
 * on one material class.
 *
 * Injected by {@link BaseMaterial3DOptions.flatShading}.
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
