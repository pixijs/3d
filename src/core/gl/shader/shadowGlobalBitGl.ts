import type { ShaderBit } from '../../shader/ShaderBit';

/**
 * Minimal global bindings for the WebGL shadow-map pass
 *
 * Kept separate from the main scene global bit so shadow shaders only receive the
 * uniforms/resources they actually use. The cascade's matrices are not here: it draws from a
 * camera group at group 1, like every other mesh draw. The bone pit and the morph and geometry
 * stores let skinned and morphed casters deform their depth as they do in colour.
 *
 * The bindings' order sets their slots in `ShadowRenderPassGl`'s bind group.
 * @internal
 */
export const shadowGlobalBitGl: ShaderBit = {
  name: 'shadowGlobalGl',
  bindings: {
    global: {
      uBatchWorldMatrix: 'mat4x4<f32>',
      uBonePitTexture: 'texture_2d<f32>',
      uMorphTexture: 'texture_2d<f32>',
      uGeometryTexture: 'texture_2d<u32>',
    },
  },
};
