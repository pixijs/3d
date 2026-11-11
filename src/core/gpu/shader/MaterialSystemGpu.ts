import type { ShaderGroups, WebGPURenderer } from 'pixi.js';
import { ExtensionType, Shader, ShaderOverrides, ShaderStage } from 'pixi.js';

import {
  collectTextureNames,
  getMaterialLayout,
  validateMaterialStruct,
  validateMaterialTextureSlots,
} from '../../../materials/utils/validateMaterialTextureSlots';
import type { MaterialLayout } from '../../../materials/utils/validateMaterialTextureSlots';
import type { View3D } from '../../../scene/View3D';
import type { Mesh3DBatch } from '../../batcher/Mesh3DBatch';
import { Mesh3DBatcher } from '../../batcher/Mesh3DBatcher';
import { MeshPassCache } from '../../batcher/Mesh3DData';
import type { Mesh3DData } from '../../batcher/Mesh3DData';
import { addPassMaterialBits } from '../../render-graph/sceneOutputs';
import { RenderPassBit } from '../../render-passes/RenderPass';
import { assertBindGroups, assertBitIdentity } from '../../shader/bitRegistry';
import { alphaOpaqueBit } from '../../shader/bits/alphaOpaqueBit';
import { anisotropyTangentVariant } from '../../shader/bits/anisotropyBit';
import { cameraBit } from '../../shader/bits/cameraBit';
import { displayColorSpaceBit, selectColorSpaceBit } from '../../shader/bits/colorSpaceBits';
import { decodeToLinearBit } from '../../shader/bits/decodeToLinearBit';
import { doubleSidedNormalBit } from '../../shader/bits/doubleSidedNormalBit';
import { flatShadingBit } from '../../shader/bits/flatShadingBit';
import type { MaterialShaderForm } from '../../shader/bits/materialBindingsBit';
import { getMeshBillboardBit } from '../../shader/bits/meshBillboardBits';
import { normalBit } from '../../shader/bits/normalBit';
import { normalMappingBit } from '../../shader/bits/normalMappingBit';
import { noShadowBit } from '../../shader/bits/noShadowBit';
import { getPositionBit } from '../../shader/bits/positionBit';
import { tangentNormalMappingBit } from '../../shader/bits/tangentNormalMappingBit';
import { srgbEncodeBit } from '../../shader/bits/tonemapping/srgbEncodeBit';
import { getUvsBit } from '../../shader/bits/uvsBit';
import { vertexColorBit } from '../../shader/bits/vertexColorBit';
import { readsInstanceData } from '../../shader/codegen/instanceAccess';
import { materialStructPackPlugin } from '../../shader/codegen/materialStructPackPlugin';
import type { ShaderBit } from '../../shader/ShaderBit';
import { resolveBindGroups } from '../../shader/ShaderBitTemplate';
import type { ShaderBitTemplate } from '../../shader/ShaderBitTemplate';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';
import { ShaderDescriptor } from '../../shader/ShaderDescriptor';
import { NORMAL_MAP } from '../../textures/DefaultTextures';
import { morphTargetBitGpu, morphTargetNormalBitGpu } from '../bits/morphTargetBitGpu';
import { shadowBitsGpu } from '../bits/shadowBitGpu';
import { skinningBitGpu } from '../bits/skinningBitGpu';
import { compileWgslSource } from '../codegen/compileWgslSource';
import { materialTextureAccessPlugin } from '../codegen/materialTextureAccessPlugin';
import { globalBitGpu } from './globalBitGpu';
import { createTexturesPluginGpu } from './texturesPluginGpu';

const scratchDescriptor = new ShaderDescriptor({});

/** Pixi's `getPipelineKey` reads `overrides.id`, so a shader without overrides would key as NaN */
const NO_OVERRIDES = new ShaderOverrides({});

const MATERIAL_PLUGINS: Record<MaterialShaderForm, ShaderCompilerPlugin[]> = {
  direct: [materialStructPackPlugin, createTexturesPluginGpu('direct')],
  merged: [materialStructPackPlugin, materialTextureAccessPlugin, createTexturesPluginGpu('merged')],
};

/**
 * `normalScale` gives a rotation-and-scale matrix's inverse transpose in three dots; `modelMatrix3` follows
 * `vertexBeforeTransform`, which may replace `modelMatrix`; `outputs.color` is premultiplied for pixi's `normal` blend
 */
const gpuTemplate = /*wgsl*/ `


{{header}}
{{textureGetters}}
{{vertexHeader}}

@vertex
fn mainVertex(input: VertexInput,
  @builtin(instance_index) ii: u32,
  @builtin(vertex_index) vid: u32
) -> VertexOutput {
  var output: VertexOutput;

  var position: vec4<f32>;
  var normal = vec3<f32>(0.0, 0.0, 1.0);
  var tangent = vec3<f32>(0.0);
  var uv = vec2<f32>(0.0);
  
  let inst = uRenderableInstanceStorage[ii];
  let renderable = uRenderableStorage[inst.id];
  let vMaterialIndex = renderable.materialIndex;
  {{vertexStoreAccess}}

  let batchWorldMatrix = uRenderableStorage[0].transform;
  var modelMatrix = batchWorldMatrix * renderable.transform;

  {{vertexInput}}

  {{vertexBeforeTransform}}

  var worldPosition = modelMatrix * position;
  let modelMatrix3 = mat3x3<f32>(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz);

  let normalScale = 1.0 / vec3<f32>(
    dot(modelMatrix3[0], modelMatrix3[0]),
    dot(modelMatrix3[1], modelMatrix3[1]),
    dot(modelMatrix3[2], modelMatrix3[2])
  );
  var worldNormal = modelMatrix3 * (normal * normalScale);
  var clipPosition = camera.uViewProjectionMatrix * worldPosition;

  {{vertexAfterTransform}}

  {{vertexEnd}}

  output.position       = clipPosition;
  output.vPosition      = worldPosition.xyz;
  output.vNormal        = worldNormal;
  output.vUV            = uv;
  output.vMaterialIndex = renderable.materialIndex;

  return output;
}

@fragment
fn mainFragment(input: FragmentInput) -> FragmentOutput {
  {{fragmentDeclareOutputs}}
  var normal = normalize(input.vNormal);
  var albedo: vec3<f32> = vec3<f32>(1.0);
  var finalColor: vec3<f32>;
  var alpha: f32 = 1.0;

  let vMaterialIndex = input.vMaterialIndex;
  {{fragmentStoreAccess}}

  {{fragmentMaterial}}

  finalColor = albedo;

  {{fragmentLighting}}

  finalColor *= inputExposure(global.uExposure, global.uDisplayExposure);

  {{fragmentEnd}}

  outputs.color = vec4<f32>(finalColor * alpha, alpha);

  {{fragmentWriteOutputs}}
}
`;

const layoutBit: ShaderBit = {
  name: 'layout',
  overrideDefs: {
    HAS_UVS: { type: 'u32', required: true },
  },
  outputs: {
    color: 'vec4<f32>',
  },
  interStage: {
    vNormal: 'vec3<f32>',
    vUV: 'vec2<f32>',
    vPosition: 'vec3<f32>',
    vMaterialIndex: 'u32',
  },
};

const template: ShaderBitTemplate = {
  bindGroups: [{ name: 'global', ubo: true }, 'camera', 'batch'],
  gpu: gpuTemplate,
};

const BUDGETED_STAGES = [
  [ShaderStage.VERTEX, 'vertex'],
  [ShaderStage.FRAGMENT, 'fragment'],
] as const;

/**
 * Throws before WebGPU sees the layout, since its own failure stops the whole canvas with an error
 * that names no material; every binding counts in each stage it's visible to, read or not
 * @param layout - The compiled shader's bind group layout, its entries by group index
 * @param materialGroup - Index of the `batch` group, or -1 for a template without one
 * @param limits - The device's limits
 * @param mesh - The mesh whose material the error names
 * @param bits - The compiled shader's bits
 */
function assertStageBindingBudget(
  layout: GPUBindGroupLayoutEntry[][],
  materialGroup: number,
  limits: GPUSupportedLimits,
  mesh: Mesh3DData,
  bits: readonly ShaderBit[],
): void {
  const { maxSamplersPerShaderStage, maxSampledTexturesPerShaderStage } = limits;

  for (const [stage, stageName] of BUDGETED_STAGES) {
    let textures = 0;
    let samplers = 0;
    let materialTextures = 0;
    let materialSamplers = 0;

    for (let g = 0; g < layout.length; g++) {
      const entries = layout[g];
      if (!entries) continue;
      for (const entry of entries) {
        if (!(entry.visibility & stage)) continue;
        if (entry.texture) {
          textures++;
          if (g === materialGroup) materialTextures++;
        }
        if (entry.sampler) {
          samplers++;
          if (g === materialGroup) materialSamplers++;
        }
      }
    }

    const samplersOver = samplers > maxSamplersPerShaderStage;
    if (!samplersOver && textures <= maxSampledTexturesPerShaderStage) continue;

    const samplerCount = `${samplers} samplers`;
    const samplerLimit = `${maxSamplersPerShaderStage} (maxSamplersPerShaderStage)`;
    const textureCount = `${textures} sampled textures`;
    const textureLimit = `${maxSampledTexturesPerShaderStage} (maxSampledTexturesPerShaderStage)`;
    const [over, overLimit, other] = samplersOver
      ? [samplerCount, samplerLimit, `Sampled textures: ${textures} of ${textureLimit}`]
      : [textureCount, textureLimit, `Samplers: ${samplers} of ${samplerLimit}`];
    const names = collectTextureNames(bits);

    throw new Error(
      `[MaterialSystemGpu] ${mesh.material.constructor.name}'s shader binds ${over} in the ${stageName} ` +
        `stage, but this device allows ${overLimit}. ${other}. The engine's globals take ` +
        `${samplers - materialSamplers} samplers and ${textures - materialTextures} sampled textures, and ` +
        `the material's ${names.length} texture slots take ${materialSamplers} samplers and ` +
        `${materialTextures} sampled textures: ${names.join(', ')}. Turn off a feature group or remove a ` +
        'texture slot.',
    );
  }
}

/** @internal */
export class MaterialSystemGpu {
  /** @ignore */
  public static extension = {
    type: [ExtensionType.WebGPUSystem],
    name: 'material3d',
  } as const;

  public batcher = new Mesh3DBatcher(this);

  private _destroyed = false;
  private readonly _renderer: WebGPURenderer;
  public _shaderCache = new Map<string, { shader: Shader; layout: MaterialLayout }>();

  constructor(renderer: WebGPURenderer) {
    this._renderer = renderer;
  }

  public computeBatchKey(item: Mesh3DData, bit: number): number {
    const cache = item._passCache[bit];
    return this._renderer.pipeline.getPipelineKey(
      item.geometry,
      cache.shader.gpuProgram,
      cache.state,
      cache.topology,
      cache.shader._overrides ?? NO_OVERRIDES,
    );
  }

  public compilePassShader(bits: ShaderBit[], template: ShaderBitTemplate): Shader {
    const gpu = compileWgslSource({ bits: [globalBitGpu, cameraBit, ...bits], template });
    assertBindGroups(gpu.bits, template);
    return Shader.from({ gpu });
  }

  public compileIsolatedShader(bits: ShaderBit[], template: ShaderBitTemplate, groups: ShaderGroups): Shader {
    return Shader.from({ gpu: compileWgslSource({ bits, template }), groups });
  }

  /**
   * Appends the position, morph and skinning bits in that order, so skinning moves the morphed vertex,
   * and adds what it appends to the key; validation reads the material, so it runs on cache hits too
   */
  public compileShader(
    descriptor: ShaderDescriptor,
    mesh: Mesh3DData,
    batch: Mesh3DBatch,
    plugins?: ShaderCompilerPlugin[],
    validateMaterial?: boolean,
    form: MaterialShaderForm = 'direct',
  ): Shader {
    const finalBits: ShaderBit[] = [];
    let key = '';
    if (descriptor.includeGlobal ?? true) {
      finalBits.push(globalBitGpu);
      key += `${globalBitGpu.name}|`;
    }
    if (descriptor.includeCamera ?? true) {
      finalBits.push(cameraBit);
      key += `${cameraBit.name}|`;
    }
    finalBits.push(...descriptor.bitsGpu);
    key += descriptor.keyGpu;

    const positionBit = getPositionBit(mesh.geometry.attributes.aPosition.format!);
    assertBitIdentity(positionBit);
    finalBits.push(positionBit);
    key += `|${positionBit.name}`;

    if (mesh._morph) {
      if (mesh.geometry.hasMorphNormals) {
        finalBits.push(morphTargetNormalBitGpu);
        key += '|morphN';
      } else {
        finalBits.push(morphTargetBitGpu);
        key += '|morph';
      }
    }

    if (mesh.skeleton) {
      assertBitIdentity(skinningBitGpu);
      finalBits.push(skinningBitGpu);
      key += `|${skinningBitGpu.name}`;
    }

    if (batch.instanceStoreBuffer && readsInstanceData(finalBits)) {
      key += `|inst:${batch.instanceStoreBuffer.layout.key}`;
    }

    key += `|${form}`;

    let entry = this._shaderCache.get(key);

    if (!entry) {
      const gpu = compileWgslSource({
        bits: finalBits,
        template: descriptor.template!,
        extraPlugins: plugins,
        instanceLayout: batch.instanceStoreBuffer?.layout,
        outputLocations: descriptor.outputLocations,
      });

      assertBindGroups(gpu.bits, descriptor.template!);
      assertStageBindingBudget(
        gpu.gpuLayout,
        resolveBindGroups(descriptor.template!).findIndex((group) => group.name === 'batch'),
        this._renderer.gpu.device.limits,
        mesh,
        gpu.bits,
      );

      entry = { shader: Shader.from({ gpu, overrides: descriptor.overrides }), layout: getMaterialLayout(gpu.bits) };
      this._shaderCache.set(key, entry);
    }

    if (validateMaterial) {
      validateMaterialTextureSlots(entry.layout, mesh.material);
      validateMaterialStruct(entry.layout, mesh.material);
    }

    return entry.shader;
  }

  /**
   * Looks the store up through `renderPipes` each call, since pixi builds pipes after systems, and drops
   * the merged shader, which `ensureMergedShader` rebuilds from the same bits
   */
  public ensureMaterial(mesh: Mesh3DData, batch: Mesh3DBatch, view3d: View3D): Shader {
    const material = mesh.material;

    this._renderer.renderPipes.view3d.materialStoreBuffer.register(material);

    const shader = this.compileShader(
      this._materialDescriptor(mesh, view3d),
      mesh,
      batch,
      MATERIAL_PLUGINS.direct,
      true,
    );

    const passBit = material._passBit & RenderPassBit.MATERIAL_PASS_MASK;
    const pd = material._passes[passBit];
    const state = (pd && pd.state) || material.state;
    const topology = (pd && pd.topology) || material.topology || mesh.geometry.topology;
    const cache = mesh._passCache[passBit];
    if (!cache) {
      mesh._passCache[passBit] = new MeshPassCache(shader, state, topology);
    } else {
      cache.shader = shader;
      cache.mergedShader = null;
      cache.state = state;
      cache.topology = topology;
      cache.lastGeometryUid = -1;
    }

    return shader;
  }

  /** Call after `ensureMaterial` has built the mesh's pass cache entry this frame */
  public ensureMergedShader(mesh: Mesh3DData, batch: Mesh3DBatch, view3d: View3D): Shader {
    const cache = mesh._passCache[mesh.material._passBit & RenderPassBit.MATERIAL_PASS_MASK];
    if (cache.mergedShader) return cache.mergedShader;

    const descriptor = this._materialDescriptor(mesh, view3d);
    cache.mergedShader = this.compileShader(descriptor, mesh, batch, MATERIAL_PLUGINS.merged, true, 'merged');

    return cache.mergedShader;
  }

  /**
   * Bits share slots and run in list order, so the order is load-bearing: normals settle before the
   * material's bits, billboarding before fog, fog before tone mapping, and the pass's output bits go last
   * @returns `scratchDescriptor`, which the next call overwrites
   */
  private _materialDescriptor(mesh: Mesh3DData, view3d: View3D): ShaderDescriptor {
    const geometry = mesh.geometry;
    const material = mesh.material;
    const fogBit = material.fog ? view3d._fogBit : null;
    const toneBit = view3d._toneMappingBit;
    const vertexColored = !!geometry.attributes.aColor && material.vertexColors;
    const colorSpaceBit = selectColorSpaceBit(material, toneBit, !!fogBit || vertexColored);
    const materialDescriptor = material.getPrimaryDescriptor(view3d);

    const bitsGpu: ShaderBit[] = [globalBitGpu, layoutBit, colorSpaceBit];

    if (geometry.attributes.aNormal) bitsGpu.push(normalBit);
    if (geometry.attributes.aUV) bitsGpu.push(getUvsBit(geometry.attributes.aUV.format!));
    if (material.doubleSided) bitsGpu.push(doubleSidedNormalBit);

    if (material.flatShading) bitsGpu.push(flatShadingBit);

    const normalTexture = material.textures.normal;

    if (normalTexture && normalTexture !== NORMAL_MAP && geometry.attributes.aUV) {
      bitsGpu.push(geometry.attributes.aTangent ? tangentNormalMappingBit : normalMappingBit);
    }

    if (vertexColored) {
      bitsGpu.push(vertexColorBit);
    }

    const lit = mesh.material.lit;

    if (mesh.billboardMode !== 'none') {
      bitsGpu.push(getMeshBillboardBit(mesh.billboardMode, lit));
    }

    const hasTangent = !!geometry.attributes.aTangent;
    for (let i = 0; i < materialDescriptor.bitsGpu.length; i++) {
      const bit = materialDescriptor.bitsGpu[i];
      bitsGpu.push(hasTangent ? anisotropyTangentVariant(bit) : bit);
    }

    if (material.alphaMode === 'opaque') bitsGpu.push(alphaOpaqueBit);

    if (fogBit) bitsGpu.push(fogBit);

    if (colorSpaceBit !== displayColorSpaceBit && toneBit) {
      bitsGpu.push(material._skipsToneCurve ? srgbEncodeBit : toneBit);
    }

    if (lit) {
      bitsGpu.push(
        mesh.receiveShadow && view3d._hasShadows ? shadowBitsGpu[view3d.shadowFilter] : noShadowBit,
        decodeToLinearBit(toneBit !== null),
      );
    }

    const pass = view3d.passByBit[material._passBit & RenderPassBit.MATERIAL_PASS_MASK];
    const outputLocations = addPassMaterialBits(bitsGpu, pass, !!materialDescriptor.template);

    return scratchDescriptor.update({
      bitsGpu,
      template: materialDescriptor.template ?? template,
      overrides: {
        HAS_UVS: geometry.attributes.aUV ? 1 : 0,
        ...materialDescriptor.overrides,
      },
      outputLocations,
      includeGlobal: false,
    });
  }

  /**
   * Leaves the programs, which pixi's process-wide program cache owns; the batcher holds no GPU
   * resources, its bind groups belonging to each `DrawCommandList`
   */
  public destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    for (const { shader } of this._shaderCache.values()) shader.destroy();
    (this._shaderCache as Map<string, { shader: Shader; layout: MaterialLayout }> | null) = null;
  }
}

declare global {
  namespace PixiMixins {
    interface WebGPUSystems {
      /** Compiles and caches 3D material shaders, and owns the mesh batcher */
      material3d: MaterialSystemGpu;
    }
  }
}
