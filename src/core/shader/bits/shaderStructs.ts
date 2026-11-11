/**
 * Fields stay in the order of `Mesh3DDataStoreBuffer`'s `MESH3D_LANE_*` constants
 * @internal
 */
export const RenderableStruct = {
  transform: 'mat4x4<f32>',
  bonePitIndex: 'u32',
  materialIndex: 'u32',
  geometryDataIndex: 'u32',
  visibility: 'u32',
  morphWeightIndex: 'u32',
} as const;

/**
 * Must match `GEOMETRY_DATA_STRIDE`; a `boundsRadius` below 0 marks dynamic geometry, never culled
 * @internal
 */
export const GeometryDataStruct = {
  boundsCenter: 'vec3<f32>',
  boundsRadius: 'f32',
  morphDeltaBase: 'u32',
  morphTargetCount: 'u32',
  baseVertex: 'u32',
  _pad: 'u32',
} as const;

/** @internal */
export const RenderableInstanceStruct = {
  id: 'u32',
} as const;

/**
 * The top three rows, so indexing gives a row; a `mat3x4` takes 48 bytes where `mat4x3` pads to 64
 * @internal
 */
export const BoneMatrixStruct = {
  rows: 'mat3x4<f32>',
} as const;

/**
 * Must match `LightDataList`'s layout
 * @internal
 */
export const LightStructGpu = {
  position: 'vec3<f32>',
  kind: 'f32',
  color: 'vec3<f32>',
  rangeSq: 'f32',
  direction: 'vec3<f32>',
  coneCos: 'f32',
  innerConeCos: 'f32',
  shadowDataIndex: 'f32',
  cascadeCount: 'f32',
  radiusPow4: 'f32',
} as const;

/**
 * `LightDataList`'s layout as `getLight` in `createLightingBit` unpacks it, without the cascade count
 * @internal
 */
export const LightStructGl = {
  position: 'vec3<f32>',
  type: 'f32',
  color: 'vec3<f32>',
  rangeSq: 'f32',
  direction: 'vec3<f32>',
  coneCos: 'f32',
  innerConeCos: 'f32',
  shadowDataIndex: 'f32',
  radiusPow4: 'f32',
} as const;

/**
 * Must match `ShadowDataList`'s layout
 * @internal
 */
export const ShadowDataStructGl = {
  lightSpaceMatrix: 'mat4x4<f32>',
  shadowParams: 'vec4<f32>',
  cascadeSplits: 'vec4<f32>',
} as const;
