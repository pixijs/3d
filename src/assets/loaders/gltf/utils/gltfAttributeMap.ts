/**
 * The `Geometry3DOptions` field each glTF attribute fills
 *
 * The plain and the Draco paths both read attributes through it, so they agree on every file. An
 * attribute missing here is skipped with a warning.
 * @internal
 */
export const GLTF_SEMANTIC_TO_ATTRIBUTE: Record<string, string> = {
  POSITION: 'positions',
  NORMAL: 'normals',
  TEXCOORD_0: 'uvs',
  JOINTS_0: 'joints',
  WEIGHTS_0: 'weights',
  TANGENT: 'tangents',
  COLOR_0: 'colors',
  COLOR_1: 'colors1',
};
