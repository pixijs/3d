/**
 * One row of the mesh store, `uRenderableStorage`: the world matrix, then the indices into the
 * bone, material, geometry and morph stores
 *
 * The field order must match the `MESH3D_LANE_*` constants of `Mesh3DDataStoreBuffer`, which the
 * CPU writes by. The fields take 84 bytes, and WGSL rounds the struct up to its 16-byte alignment,
 * so a row is 96 bytes, the 24 words `MESH3D_STORE_STRIDE` must equal.
 *
 * - `geometryDataIndex`, lane 18: the geometry's row in `uGeometryStorage`, which GPU culling reads
 *   for the bounds sphere and the morph bits read for the morph facts.
 * - `visibility`, lane 19: 0 when the mesh is hidden. The culling passes read it and the mesh
 *   shaders never do, but it has to be here for the stride.
 * - `morphWeightIndex`, lane 20: where the instance's morph weights start in `uMorphStorage`, in
 *   floats. Real offsets start past the morph deltas, so 0 means no morph state, and the morph bits
 *   skip the mesh.
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
 * One row of the geometry store, `uGeometryStorage`: the bounding sphere, then the geometry's morph
 * facts
 *
 * `GeometryDataStoreBuffer` writes it, 8 words a row. A `boundsRadius` below 0 marks dynamic
 * geometry, which keeps its morph facts but is never frustum-culled.
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

/**
 * One instance of a batch's draw list for a pass: its row in `uRenderableStorage`, and its
 * textures' batch slots, four bits each
 *
 * Two `u32`s make an 8-byte stride with no padding.
 * @internal
 */
export const RenderableInstanceStruct = {
  id: 'u32',
  texSlots: 'u32',
} as const;

/**
 * One skinning matrix in the bone store, `uBoneStorage`, which the `BonePit` fills
 *
 * `rows` holds the matrix's top three rows, and indexing it gives a row. `mat3x4` is three
 * `vec4` columns, 48 bytes. `mat4x3` would be four `vec3` columns, and WGSL pads each to 16 bytes,
 * so it takes the same 64 bytes as a `mat4x4`.
 * @internal
 */
export const BoneMatrixStruct = {
  rows: 'mat3x4<f32>',
} as const;

/**
 * One light as the WebGPU light loop builds it from `uLightData`, which `LightDataList` packs
 *
 * - `kind`: 0 directional, 1 point, 2 spot.
 * - `range`: how far the light reaches; 0 means no limit, and a directional light always has 0.
 * - `coneCos`: a spot light's outer edge, the cosine of the angle where its light ends.
 * - `innerConeCos`: the cosine where full intensity starts; equal to `coneCos` with no penumbra.
 * - `shadowDataIndex`: the light's first slot in the shadow data, or -1 with no shadow.
 * - `cascadeCount`: 1 for one shadow map, 2 to `MAX_CASCADES` for cascades.
 * @internal
 */
export const LightStructGpu = {
  position: 'vec3<f32>',
  kind: 'f32',
  color: 'vec3<f32>',
  range: 'f32',
  direction: 'vec3<f32>',
  coneCos: 'f32',
  innerConeCos: 'f32',
  shadowDataIndex: 'f32',
  cascadeCount: 'f32',
  _pad: 'f32',
} as const;

/**
 * One light as the WebGL light loop sees it, unpacked from `uLightData` by `getLight`
 *
 * The fields mean what they do on `LightStructGpu`, but the kind is called `type`, and the cascade
 * count isn't here: WebGL reads it from the shadow data's `shadowParams.w`.
 * @internal
 */
export const LightStructGl = {
  position: 'vec3<f32>',
  type: 'f32',
  color: 'vec3<f32>',
  range: 'f32',
  direction: 'vec3<f32>',
  coneCos: 'f32',
  innerConeCos: 'f32',
  shadowDataIndex: 'f32',
} as const;

/**
 * One shadow map's data on WebGL, at the light's `shadowDataIndex`
 *
 * `shadowParams` holds the bias, the normal bias, the map size and the cascade count, in that
 * order. `cascadeSplits` holds the view-space depths where the cascades split; the shader reads them
 * from the light's first slot.
 * @internal
 */
export const ShadowDataStructGl = {
  lightSpaceMatrix: 'mat4x4<f32>',
  shadowParams: 'vec4<f32>',
  cascadeSplits: 'vec4<f32>',
} as const;
