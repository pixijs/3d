import type { ShaderBit } from '../../shader/ShaderBit';

/**
 * Minimal global bindings for the WebGL shadow-map pass
 *
 * Kept separate from the main scene global bit so shadow shaders only receive the
 * uniforms/resources they actually use. The cascade's matrices are not here — it draws from a
 * camera group at group 1, like every other mesh draw.
 * @internal
 */
export const shadowGlobalBitGl: ShaderBit = {
  name: 'shadowGlobalGl',
  bindings: {
    global: {
      uBatchWorldMatrix: 'mat4x4<f32>',
      uBonePitTexture: 'texture_2d<f32>',
      // Shadow-morph: the shared morph store + per-geometry facts as data-texture
      // views, read by morphTargetBitGl to deform the caster's depth. Bound per
      // frame in ShadowRenderPassGl (slots 2–3, after the bone-pit at 1).
      uMorphTexture: 'texture_2d<f32>',
      uGeometryTexture: 'texture_2d<f32>',
    },
  },
};
