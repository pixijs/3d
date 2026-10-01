import {
  RenderableStruct,
  RenderableInstanceStruct,
  BoneMatrixStruct,
  GeometryDataStruct,
} from '../../shader/bits/shaderStructs';
import type { ShaderBit } from '../../shader/ShaderBit';

/**
 * The shadow pass's `global` group: only the scene data a depth-only draw reads
 *
 *   0 – store buffer  (Renderable[])
 *   1 – instance buffer (RenderableInstance[])
 *   2 – bone buffer   (BoneMatrix[])
 *   3 – morph delta + weight store (f32[])
 *   4 – per-geometry facts (GeometryData[])
 *
 * The binding order must match the group 0 `ShadowRenderPassGpu` builds and re-points per bundle.
 * The cascade's matrices come from the camera group at 1, as for every other mesh draw.
 * `globalBitGpu` can't stand in: it declares fifteen bindings, with these five at 10 to 14, so its
 * layout wouldn't match this group.
 *
 * The pass's fragment stage is empty, so every buffer is tagged `'vertex'` and none spends a
 * fragment storage-buffer slot.
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
      uRenderableStorage: { type: 'storage<Renderable>', visibility: 'vertex' },
      uRenderableInstanceStorage: { type: 'storage<RenderableInstance>', visibility: 'vertex' },
      uBonePitStorage: { type: 'storage<BoneMatrix>', visibility: 'vertex' },
      uMorphStorage: { type: 'storage<f32>', visibility: 'vertex' },
      uGeometryStorage: { type: 'storage<GeometryData>', visibility: 'vertex' },
    },
  },
};
