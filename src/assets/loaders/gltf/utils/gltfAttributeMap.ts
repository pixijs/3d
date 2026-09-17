/**
 * Maps glTF attribute semantic names to the internal attribute names used by `Geometry3D` / `Geometry3DOptions`
 *
 * Both Draco and non-Draco loader paths must agree on this mapping to keep behavior consistent.
 * @internal
 */
export const GLTF_SEMANTIC_TO_ATTRIBUTE: Record<string, string> = {
  POSITION: 'positions',
  NORMAL: 'normals',
  TEXCOORD_0: 'uvs',
  JOINTS_0: 'joints',
  WEIGHTS_0: 'weights',
  TANGENT: 'tangents',
  // Color sets pass through untouched; `BaseMaterial3D.vertexColors` decides
  // whether the first one tints, and nothing consumes `colors1` by default.
  COLOR_0: 'colors',
  COLOR_1: 'colors1',
};
