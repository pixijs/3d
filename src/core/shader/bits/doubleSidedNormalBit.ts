import type { ShaderBit } from '../ShaderBit';

/**
 * Flips the shading normal on back faces, for a material with {@link BaseMaterial3D#doubleSided}
 *
 * A back face's normals point away from the viewer, so without the flip its lighting is wrong. The
 * glTF spec asks for the same: a double-sided back face "must have its normals reversed before the
 * lighting equation is evaluated". The renderer adds it ahead of the material's own bits, so
 * everything that reads `normal` sees the flipped one.
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
