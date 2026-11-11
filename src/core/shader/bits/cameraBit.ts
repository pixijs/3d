import { LIGHT_DEPTH_LANES, LIGHT_TILE_LANES } from '../../LightTiles';
import type { ShaderBit } from '../ShaderBit';

/**
 * Must match the uniform group `CameraData` builds, field for field and in order
 * @internal
 */
export const cameraBit: ShaderBit = {
  name: 'camera',
  bindings: {
    camera: {
      uCameraPosition: 'vec3<f32>',
      uViewMatrix: 'mat4x4<f32>',
      uProjectionMatrix: 'mat4x4<f32>',
      uViewProjectionMatrix: 'mat4x4<f32>',
      uPreviousViewProjectionMatrix: 'mat4x4<f32>',
      uViewportUVScale: 'vec2<f32>',
      uLightTileTransform: 'vec4<f32>',
      uLightTiles: `array<vec4<i32>, ${LIGHT_TILE_LANES}>`,
      uLightDepthMasks: `array<vec4<i32>, ${LIGHT_DEPTH_LANES}>`,
      uLightDepthPlane: 'vec4<f32>',
    },
  },
};
