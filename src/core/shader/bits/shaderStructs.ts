/**
 * Shared GPU/GL struct definitions used across multiple ShaderBits
 *
 * Keeping them in one place prevents silent drift between bits that
 * declare the same struct (the compiler deduplicates by name, so
 * mismatched fields would cause hard-to-trace bugs).
 */

// ── Shared (GPU + GL) structs ───────────────────────────────────────

/**
 * One row of the per-renderable data store (`uRenderableStorage`): the model
 * transform plus the indices that fan out to the bone, material, geometry, and
 * morph stores
 *
 * WGSL pads this struct to 96 bytes (24 floats); the CPU-side store buffer
 * stride must match (see `Mesh3DDataStoreBuffer`).
 * @internal
 */
export const RenderableStruct = {
  transform: 'mat4x4<f32>',
  bonePitIndex: 'u32',
  materialIndex: 'u32',
  // Lane 18: the geometry's row in `uGeometryStorage` — read by the GPU cull
  // compaction (bounds sphere) and by the morph bits (per-geometry morph texel).
  geometryDataIndex: 'u32',
  // Lane 19: written by the CPU store copier and read at draw-data level, never
  // by the forward shader. Declared so the struct stride matches the store
  // buffer — see MESH3D_LANE_VISIBILITY.
  visibility: 'u32',
  // Absolute float offset of this instance's morph weights in `uMorphStorage`.
  // 0 = no slot (real offsets start past the delta arena), which is how the
  // morph bits skip meshes without morph state. The per-geometry morph facts
  // (delta base, target count, atlas base vertex) live in `uGeometryStorage`.
  morphWeightIndex: 'u32',
} as const;

/**
 * One row of the per-geometry data store (`uGeometryStorage`, backed by
 * `GeometryDataStoreBuffer`, stride 8 floats): the cull sphere, then the
 * per-geometry morph facts
 *
 * `boundsRadius < 0` marks dynamic geometry — registered so the morph texel is
 * live, but never frustum-culled.
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
 * One draw-order slot of the per-(batch, pass) instance buffer: the store index
 * to indirect into `uRenderableStorage`, plus this element's packed batch
 * texture slots (4 bits per texture)
 *
 * Two u32 = 8-byte stride, no padding.
 * @internal
 */
export const RenderableInstanceStruct = {
  id: 'u32',
  texSlots: 'u32',
} as const;

/**
 * One skinning matrix element of the bone storage (`uBoneStorage`, backed by
 * the BonePit)
 * @internal
 */
export const BoneMatrixStruct = {
  // Three rows of four. `mat3x4` is 3 columns of `vec4` = 48 bytes; the tempting
  // `mat4x3` is 4 columns of `vec3`, and WGSL pads each `vec3` column to 16 bytes,
  // so it costs the same 64 as a `mat4x4` and saves nothing. Indexing gives the rows.
  rows: 'mat3x4<f32>',
} as const;

// ── WebGPU structs ──────────────────────────────────────────────────

/**
 * One light as the WebGPU light loop sees it, unpacked from `uLightData` (see
 * `LightDataList` for the CPU-side writer)
 * @internal
 */
export const LightStructGpu = {
  position: 'vec3<f32>',
  kind: 'f32', // 0 = directional, 1 = point, 2 = spot
  color: 'vec3<f32>',
  range: 'f32', // falloff distance (0 = infinite for directional)
  direction: 'vec3<f32>',
  coneCos: 'f32', // cos of outer cone angle for spot lights (light vanishes here)
  innerConeCos: 'f32', // cos of inner cone (full intensity); equal to coneCos when penumbra=0
  shadowDataIndex: 'f32', // index into uShadowData array (-1 if none)
  cascadeCount: 'f32', // number of CSM cascades (0 = standard shadow)
  _pad: 'f32',
} as const;

// ── WebGL structs ───────────────────────────────────────────────────

/**
 * Per-light element of the WebGL light data store
 *
 * Same layout and semantics as `LightStructGpu` (GL names the light-kind field
 * `type` instead of `kind`) except the tail: the cascade count lives in the GL
 * shadow data's `shadowParams.w` instead of on the light.
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
 * Per-shadow-map element of the WebGL shadow data store, indexed by
 * `shadowDataIndex` on the light
 * @internal
 */
export const ShadowDataStructGl = {
  lightSpaceMatrix: 'mat4x4<f32>',
  shadowParams: 'vec4<f32>', // [bias, normalBias, mapSize, cascadeCount]
  cascadeSplits: 'vec4<f32>', // view-space split depths (cascade 0 only)
} as const;
