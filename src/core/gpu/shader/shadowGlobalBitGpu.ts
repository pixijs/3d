import {
  RenderableStruct,
  RenderableInstanceStruct,
  BoneMatrixStruct,
  GeometryDataStruct,
} from '../../shader/bits/shaderStructs';
import type { ShaderBit } from '../../shader/ShaderBit';

/**
 * Lean ShaderBit for the WebGPU shadow pass
 *
 * Declares only the resources `ShadowRenderPassGpu` puts into its group 0 — the scene data a
 * depth-only draw reads, all of it view-scoped or per batch:
 *
 *   0 – store buffer  (Renderable[])
 *   1 – instance buffer (RenderableInstance[])
 *   2 – bone buffer   (BoneMatrix[])
 *   3 – morph delta + weight store (f32[])
 *   4 – per-geometry facts (GeometryData[])
 *
 * The cascade's own matrices are not here: it draws from a camera group at group 1, like every
 * other mesh draw. The full `globalBitGpu` can't be used either — its compiled shader expects
 * dozens of bindings that don't exist in the shadow bind group, mismatching the layout.
 * @internal
 */
export const shadowGlobalBitGpu: ShaderBit = {
  name: 'shadowGlobal',
  structs: {
    Renderable: RenderableStruct,
    RenderableInstance: RenderableInstanceStruct,
    BoneMatrix: BoneMatrixStruct,
    GeometryData: GeometryDataStruct,
  },
  bindings: {
    global: {
      // The shadow pass is depth-only — its fragment is empty — so every storage
      // buffer is read solely in the vertex transform. Tag them vertex so none
      // spend a fragment storage slot (matches globalBitGpu's per-stage split).
      uRenderableStorage: { type: 'storage<Renderable>', visibility: 'vertex' },
      uRenderableInstanceStorage: { type: 'storage<RenderableInstance>', visibility: 'vertex' },
      uBonePitStorage: { type: 'storage<BoneMatrix>', visibility: 'vertex' },
      // Shadow-morph: the morph delta+weight store and the per-geometry facts,
      // read by the morph bit to deform the caster's depth (bindings 3–4, bound
      // per recorded bundle in ShadowRenderPassGpu). Vertex-only, like the rest.
      uMorphStorage: { type: 'storage<f32>', visibility: 'vertex' },
      uGeometryStorage: { type: 'storage<GeometryData>', visibility: 'vertex' },
    },
  },
};
