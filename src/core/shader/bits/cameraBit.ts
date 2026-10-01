import { LIGHT_DEPTH_LANES, LIGHT_TILE_LANES } from '../../LightTiles';
import type { ShaderBit } from '../ShaderBit';

/**
 * The `camera` bind group, group 1 of every mesh-drawing template: the camera's position, view,
 * projection and their product, its target's UV scale, and the light masks
 *
 * It is apart from the global group because it is the one thing a draw depends on that isn't the
 * view's. Two passes drawing one list from different cameras bind two of these against one global
 * group. A shadow cascade is one such camera, with the light-space transform as its view and the
 * cascade's orthographic box as its projection. `uViewportUVScale` is here because it depends on
 * the target: two passes drawing one list into different textures need different values.
 *
 * The light masks pick the lights a fragment walks (see `binLightTiles`):
 * - `uLightTileTransform` maps a pixel position to tile coordinates, with the scale in `xy` and the
 *   offset in `zw`.
 * - `uLightTiles` holds one light mask per screen tile, four to an `ivec4`.
 * - `uLightDepthMasks` holds one light mask per camera-depth interval, packed the same way.
 * - `uLightDepthPlane`, dotted with a world position, gives the position's depth interval.
 *
 * One declaration serves both backends: plain uniforms with these names on WebGL, the `camera`
 * uniform struct on WebGPU. A `CameraData` holds the values.
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
      uViewportUVScale: 'vec2<f32>',
      uLightTileTransform: 'vec4<f32>',
      uLightTiles: `array<vec4<i32>, ${LIGHT_TILE_LANES}>`,
      uLightDepthMasks: `array<vec4<i32>, ${LIGHT_DEPTH_LANES}>`,
      uLightDepthPlane: 'vec4<f32>',
    },
  },
};
