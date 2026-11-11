import {
  RenderableStruct,
  RenderableInstanceStruct,
  BoneMatrixStruct,
  GeometryDataStruct,
} from '../../shader/bits/shaderStructs';
import type { ShaderBit } from '../../shader/ShaderBit';

/**
 * The bindings of `globalBitGpu` a depth-only draw reads, under the same names, which pixi matches
 * to the view's global bind group; the shadow map it renders into stays out of the layout
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
