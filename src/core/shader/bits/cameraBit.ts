import type { ShaderBit } from '../ShaderBit';

/**
 * The camera data's bind group: its position, view, projection, their product and its target's
 * UV scale, at group 1 of every mesh-drawing template
 *
 * Split out of the global group because it is the one thing a draw depends on that isn't the
 * view's: two passes drawing the same list from different camera data bind two of these against
 * one global group. A shadow cascade is one of those — its view is the light-space
 * transform and its projection the cascade's ortho box. Declared once here for both backends; on
 * WebGL the lanes are plain uniforms with these names, on WebGPU they are the `camera` uniform
 * struct. `uViewportUVScale` rides along because it is a fact about the camera's target: two
 * passes drawing one list into different textures need different values for it.
 * The group behind it is a `CameraData`.
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
    },
  },
};
