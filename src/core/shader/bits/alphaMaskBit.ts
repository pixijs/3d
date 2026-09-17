import type { ShaderBit } from '../ShaderBit';

/**
 * Alpha testing (cutout) for materials with `alphaMode: "mask"`
 *
 * Discards fragments below `alphaCutoff` and snaps survivors to fully
 * opaque — the glTF MASK spec is binary ("fully opaque or fully
 * transparent"), so any partial alpha that leaks through (e.g. from
 * anti-aliased textures) must be clamped before the premultiplied output.
 *
 * Inject AFTER base color sampling sets `alpha`.
 * @category rendering
 * @advanced
 */
export const alphaMaskBit: ShaderBit = {
  name: 'alphaMask',
  bindings: {
    material: {
      alphaCutoff: 'f32',
    },
  },
  gpu: {
    fragment: {
      material: /*wgsl*/ `
  if (alpha < material.alphaCutoff) {
    discard;
  }
  alpha = 1.0;
`,
    },
  },
  gl: {
    fragment: {
      material: /*glsl*/ `
  if (alpha < material.alphaCutoff) discard;
  alpha = 1.0;
`,
    },
  },
};
