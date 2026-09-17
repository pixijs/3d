import type { ShaderBit } from '../ShaderBit';

/**
 * Decodes the `aNormal` attribute into the vertex template's shared `normal` local
 *
 * `MaterialSystemGpu` / `MaterialSystemGl` compose this bit in `ensureMaterial` only when the
 * geometry carries an `aNormal` attribute. Geometries without one (billboarded particles,
 * screen-facing quads, unlit ribbons) keep the template's default `normal = (0, 0, 1)` and need
 * no dummy normals buffer.
 *
 * The attribute is declared `float32x3` whatever the buffer's real format: quantized normals
 * (`snorm16x4` and friends) are hardware-normalized and both backends read the leading three
 * components.
 *
 * Runs in the `input` slot so the morph-target and skinning bits, appended after it, deform an
 * already-decoded normal.
 * @internal
 */
export const normalBit: ShaderBit = {
  name: 'normal',

  attributes: {
    aNormal: 'float32x3',
  },

  gpu: {
    vertex: {
      input: 'normal = input.aNormal;',
    },
  },

  gl: {
    vertex: {
      input: 'normal = aNormal;',
    },
  },
};
