import type { ShaderBit } from '../ShaderBit';

/**
 * Flips the shading normal on back faces when the material is double-sided
 *
 * Matches glTF / common practice: vertex normals still point the same way for
 * both triangles of a thin surface, so without this, lighting on the rear side
 * is wrong. Only injected when {@link BaseMaterial3D#doubleSided} is true (fixed
 * at material construction).
 *
 * Must run before any fragment code that reads `normal` (e.g. PBR lighting).
 * @internal
 */
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
