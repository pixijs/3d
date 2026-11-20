import type { ShaderGroups, WebGPURenderer } from 'pixi.js';
import { ExtensionType, Shader, ShaderOverrides, ShaderStage } from 'pixi.js';

import {
  collectTextureNames,
  getMaterialLayout,
  validateMaterialStruct,
  validateMaterialTextureSlots,
} from '../../../materials/utils/validateMaterialTextureSlots';
import type { View3D } from '../../../scene/View3D';
import type { Mesh3DBatch } from '../../batcher/Mesh3DBatch';
import { Mesh3DBatcher } from '../../batcher/Mesh3DBatcher';
import { MeshPassCache } from '../../batcher/Mesh3DData';
import type { Mesh3DData } from '../../batcher/Mesh3DData';
import { addPassMaterialBits } from '../../render-graph/sceneOutputs';
import { RenderPassBit } from '../../render-passes/RenderPass';
import type { RenderPass } from '../../render-passes/RenderPass';
import { assertBindGroups, assertBitIdentity } from '../../shader/bitRegistry';
import { alphaOpaqueBit } from '../../shader/bits/alphaOpaqueBit';
import { anisotropyTangentVariant } from '../../shader/bits/anisotropyBit';
import { cameraBit } from '../../shader/bits/cameraBit';
import { displayColorSpaceBit, selectColorSpaceBit } from '../../shader/bits/colorSpaceBits';
import { decodeToLinearBit } from '../../shader/bits/decodeToLinearBit';
import { doubleSidedNormalBit } from '../../shader/bits/doubleSidedNormalBit';
import { flatShadingBit } from '../../shader/bits/flatShadingBit';
import type { MaterialShaderForm } from '../../shader/bits/materialBindingsBit';
import { firstBitReadingMaterial } from '../../shader/bits/materialBindingsBit';
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
import { declaredOverrides } from '../../shader/collectOverrideDefs';
import { isBitInLevel } from '../../shader/ShaderBit';
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

/** Reused by every `_passShaderDescriptor` call, so resolving a material allocates no descriptor */
const scratchDescriptor = new ShaderDescriptor({});

/** Pixi's `getPipelineKey` reads `overrides.id`, so a shader without overrides would key as NaN */
const NO_OVERRIDES = new ShaderOverrides({});

const MATERIAL_PLUGINS: Record<MaterialShaderForm, ShaderCompilerPlugin[]> = {
  direct: [materialStructPackPlugin, createTexturesPluginGpu('direct')],
  merged: [materialStructPackPlugin, materialTextureAccessPlugin, createTexturesPluginGpu('merged')],
};

/**
 * The WGSL module every material shader is built from, both stages in one source
 *
 * The vertex stage fills its slots in this order:
 *
 * - `vertexInput` decodes the attributes into the `position`, `normal`, `tangent` and `uv` locals.
 *   `compileShader` appends the position, morph and skinning bits after every other bit, in
 *   that order, so skinning sees the decoded, morphed position.
 * - `vertexBeforeTransform` changes what feeds the world transform, such as particle motion.
 * - The template builds `worldPosition`, `worldNormal` and `clipPosition` as `var`s.
 * - `vertexAfterTransform` may rewrite those, as billboarding and fog depth do.
 * - `vertexEnd` adjusts the locals last, as `uvTransformBit` does, and the template then writes
 *   the varyings once.
 *
 * `normal` starts as +Z for a geometry with no normals, and `normalBit` overwrites it. The world
 * normal is the model matrix's upper 3×3 times the normal divided by each column's squared length.
 * For a rotation-and-scale matrix that equals the inverse transpose, which tilts a normal away
 * from a stretched axis, at three dot products instead of an inverse. Tangents lie in the surface,
 * so bits transform them by `modelMatrix3` directly. `modelMatrix3` is built after
 * `vertexBeforeTransform`, so a bit there that replaces `modelMatrix` is picked up.
 *
 * `vertexStoreAccess` and `fragmentStoreAccess` are where each stage's store data comes into
 * scope: `material` in the merged form (`materialTextureAccessPlugin`; the direct form reads the
 * `material` uniform in place), then `instance` for a shader whose bits read a batch's instance
 * data (`instanceAccessPlugin`).
 *
 * The fragment stage declares `material` before any slot, so every bit can read it. `finalColor`
 * starts as `albedo`, the unlit result, and lighting bits overwrite it in `fragmentLighting`. The
 * template multiplies it by the exposure for the shader's colour space before `fragmentEnd`, where
 * fog and tone mapping run. Then it writes the result to `outputs.color`, premultiplied by alpha
 * for pixi's default `normal` blend mode. Textures stay straight alpha, as they are in 2D, so a
 * transparent material needs no blend mode of its own. `inputExposure` picks that exposure. It
 * comes from the colour-space bit that `_passShaderDescriptor`, the template's only user, always
 * adds.
 *
 * Bits write fragment outputs through the `outputs` local, which `{{fragmentDeclareOutputs}}`
 * declares, and `{{fragmentWriteOutputs}}` returns the ones the descriptor gives a location
 * (`wgslFragmentOutputsPlugin`).
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
  public _shaderCache = new Map<string, { shader: Shader; bindsMaterial: boolean }>();

  constructor(renderer: WebGPURenderer) {
    this._renderer = renderer;
  }

  /**
   * The WebGPU batch key for `item` in pass `bit`: the full graphics-pipeline
   * key (program + state + topology + overrides)
   *
   * Read on the per-dirty-mesh path by `RenderPass.onRenderableDirty`; `ensurePassShader` fills
   * `_passCache[bit]` just before.
   * @param item - The mesh to key
   * @param bit - The render pass bit whose cache entry holds the shader and state
   */
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

  public compileViewShader(bits: ShaderBit[], template: ShaderBitTemplate): Shader {
    const gpu = compileWgslSource({ bits: [globalBitGpu, cameraBit, ...bits], template });
    assertBindGroups(gpu.bits, template);
    return Shader.from({ gpu });
  }

  public compileIsolatedShader(bits: ShaderBit[], template: ShaderBitTemplate, groups: ShaderGroups): Shader {
    return Shader.from({ gpu: compileWgslSource({ bits, template }), groups });
  }

  /**
   * Compiles (or returns a cached) shader from a {@link ShaderDescriptor}
   *
   * Prepends `globalBitGpu` (scene globals at group 0) and the camera bit (group 1)
   * unless the descriptor sets `includeGlobal: false` or `includeCamera: false`, and
   * appends the mesh's position, morph and skinning bits, so callers only provide
   * the bits unique to their pass. The position bit goes before the other two so
   * they deform the position it reads, and morphing before skinning so the skin moves
   * the morphed vertex. The bits added here aren't in the descriptor's key, so their
   * names join the cache key, and variants with and without them never share an entry.
   * The compiler adds the bits a listed bit `requires`. They stay out of the key, since the
   * listed bits already imply them.
   *
   * When a bit declares `bindings.instance`, the shader is compiled against the instance-data
   * layout of the batch that owns the mesh: the layout joins the key and goes to the compile,
   * where `instanceAccessPlugin` adds the access code. A shader whose bits declare none is untouched.
   *
   * When a bit declares material fields or textures, the shader reads the material. It then gets
   * the material's layout bit ahead of the first such bit, so it declares the material's whole
   * group whichever of the material's bits it lists, and it compiles with the material plugins for `form`.
   * The layout bit's name joins the key, and so does the form, since the same bits compile to a direct
   * shader and a merged shader and both can be live at once. The material's texture slots and struct are checked
   * against what the shader declares when it compiles, and a shader that fails is not kept. A material
   * that finds the shader compiled has the layout it was checked with, since the layout bit's name is in
   * the key. A shader whose bits declare neither compiles without any of it.
   *
   * Throws on a cache miss when the shader binds more sampled textures or samplers in a stage than
   * the device allows, before WebGPU sees its layout; `assertStageBindingBudget` says why.
   *
   * Use this for custom render passes that need their own shader variant.
   * The scene update goes through `ensurePassShader`, which picks a mesh's descriptor for a pass
   * and writes the mesh's pass cache.
   * @param descriptor - The shader descriptor containing bits, template, and overrides
   * @param mesh - The mesh to compile for; its geometry and morph and skinning state pick the appended bits
   * @param batch - The batch the mesh is drawn in; a shader whose bits read instance data is compiled against its layout
   * @param form - The form a shader that reads the material compiles in
   * @returns The compiled shader, and whether a draw with it binds the material
   */
  public compileShader(
    descriptor: ShaderDescriptor,
    mesh: Mesh3DData,
    batch: Mesh3DBatch,
    form: MaterialShaderForm = 'direct',
  ): { shader: Shader; bindsMaterial: boolean } {
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

    const bits = descriptor.bitsGpu;
    const materialLayoutBit = mesh.material._materialLayoutBit;
    const readingBit = firstBitReadingMaterial(bits);
    const readsMaterial = readingBit >= 0;
    for (let i = 0; i < bits.length; i++) {
      if (i === readingBit) finalBits.push(materialLayoutBit);
      finalBits.push(bits[i]);
    }
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

    if (readsMaterial) key += `|${materialLayoutBit.name}|${form}`;

    let entry = this._shaderCache.get(key);

    if (!entry) {
      const gpu = compileWgslSource({
        bits: finalBits,
        template: descriptor.template!,
        extraPlugins: readsMaterial ? MATERIAL_PLUGINS[form] : undefined,
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

      if (readsMaterial) {
        const layout = getMaterialLayout(gpu.bits);
        validateMaterialTextureSlots(layout, mesh.material);
        validateMaterialStruct(layout, mesh.material);
      }

      entry = { shader: Shader.from({ gpu, overrides: descriptor.overrides }), bindsMaterial: readsMaterial };
      this._shaderCache.set(key, entry);
    }

    return entry;
  }

  /**
   * Resolves the shader the mesh draws with in `pass` and writes it into `mesh._passCache`
   *
   * The scene update calls it for every pass a rebuilt mesh is in, ahead of the pass's own
   * `onRenderableDirty`, once the material has its place in the pipe's material store
   * (`MaterialDataStoreBuffer.register`). It writes the shader, state and topology at the pass's
   * bit; `PassDescriptor` says how state and topology resolve.
   *
   * The shader is resolved again only when the entry is stale (`MeshPassCache.isStaleFor`):
   * something that picks a bit changed, or an `invalidate()` asked. A mesh that is dirty for
   * another reason, such as being put back in the scene, keeps its shader and takes only its
   * state and topology again. The entry is refreshed in place rather than replaced, since other
   * code holds it.
   *
   * A shader of the pass's own, or of the material's entry for the pass, that brings a template is
   * compiled as it is, whatever the pass's `level`.
   *
   * Otherwise a pass with a `level` draws with the list `_passShaderDescriptor` builds for the
   * mesh at that level, with that shader's bits added to it. A shader with no template on a pass
   * with no `level` has nothing to compile on, and throws.
   *
   * Otherwise the material's main pass draws with the material's shader, in its direct form:
   * it binds the material's own textures by binding and reads its struct from the `material`
   * uniform, the material's row of the store. Resolving it again drops the entry's merged shader,
   * since both forms come from the same bits; `ensureMergedShader` compiles it again on the next
   * merged run.
   *
   * In any other pass the mesh has no shader, and its entry is left as it is.
   * @param mesh - The mesh to resolve the shader of
   * @param batch - The batch the mesh is drawn in
   * @param pass - The pass the mesh is drawn in
   * @param view3d - The view the mesh renders in; picks the material's primary descriptor
   */
  public ensurePassShader(mesh: Mesh3DData, batch: Mesh3DBatch, pass: RenderPass, view3d: View3D): void {
    const bit = pass.bit;
    const material = mesh.material;
    const materialEntry = material._passes[bit];
    const ownDescriptor =
      (materialEntry && materialEntry.shaderDescriptor) || (pass.descriptor && pass.descriptor.shaderDescriptor);
    const level = pass.level;
    /** With no level and no shader of its own, a pass draws a material only as its main pass, as the material says */
    const drawsAsPass = !!level || !!ownDescriptor;

    if (!drawsAsPass && bit !== (material._passBit & RenderPassBit.MATERIAL_PASS_MASK)) return;

    const passEntry = drawsAsPass ? pass.descriptor : undefined;
    const state = (materialEntry && materialEntry.state) || (passEntry && passEntry.state) || material.state;
    const topology =
      (materialEntry && materialEntry.topology) ||
      (passEntry && passEntry.topology) ||
      material.topology ||
      mesh.geometry.topology;
    const viewShaderVersion = view3d._shaderVersion;
    const cache = mesh._passCache[bit];

    if (cache && !cache.isStaleFor(mesh, viewShaderVersion)) {
      cache.state = state;
      cache.topology = topology;

      return;
    }

    if (ownDescriptor && !level && !ownDescriptor.template) {
      throw new Error(
        `[MaterialSystemGpu] The '${pass.name}' pass draws ${material.constructor.name} with a shader that has no ` +
          "template. Give the pass a `level`, such as 'shape', to draw it on the material's template, or " +
          'give the shader a template of its own.',
      );
    }

    /** A shader that brings a template as it is, or else the material's bits, up to the pass's level, plus its own */
    const descriptor =
      ownDescriptor && ownDescriptor.template
        ? ownDescriptor
        : this._passShaderDescriptor(mesh, pass, view3d, ownDescriptor);
    const { shader, bindsMaterial } = this.compileShader(descriptor, mesh, batch);

    if (cache) {
      cache.shader = shader;
      cache.mergedShader = null;
      cache.state = state;
      cache.topology = topology;
      cache.bindsMaterial = bindsMaterial;
      cache.claimBuiltFrom(mesh, viewShaderVersion);
    } else {
      (mesh._passCache[bit] = new MeshPassCache(shader, state, topology, bindsMaterial)).claimBuiltFrom(
        mesh,
        viewShaderVersion,
      );
    }
  }

  /**
   * The merged-form shader of the mesh's material in `pass`, compiled on first use and kept on the
   * pass cache entry beside the direct one
   *
   * The walk asks for it when a run of one geometry and one texture set would need more than
   * `MERGE_THRESHOLD` direct commands. The bits are the ones `ensurePassShader` compiled, so the two
   * shaders agree on every varying and texture; only the plugins differ. A scene that never merges
   * never compiles one. Call it after `ensurePassShader` has built the entry for this frame.
   * @param mesh - The mesh whose material the run starts with
   * @param batch - The batch the mesh is drawn in
   * @param pass - The pass the run draws in, which draws with the material's shader
   * @param view3d - The view the mesh renders in; picks the material's primary descriptor
   * @returns The merged shader
   */
  public ensureMergedShader(mesh: Mesh3DData, batch: Mesh3DBatch, pass: RenderPass, view3d: View3D): Shader {
    const cache = mesh._passCache[pass.bit];
    if (cache.mergedShader) return cache.mergedShader;

    const materialEntry = mesh.material._passes[pass.bit];
    const passEntry = pass.descriptor;
    const ownDescriptor =
      (materialEntry && materialEntry.shaderDescriptor) || (passEntry && passEntry.shaderDescriptor);

    const descriptor =
      ownDescriptor && ownDescriptor.template
        ? ownDescriptor
        : this._passShaderDescriptor(mesh, pass, view3d, ownDescriptor);
    cache.mergedShader = this.compileShader(descriptor, mesh, batch, 'merged').shader;

    return cache.mergedShader;
  }

  /**
   * Fills `scratchDescriptor` with the bit list of the mesh's main-pass shader, for either form to
   * compile
   *
   * Bits run in list order and several write the same slots, so the order matters:
   *
   * - Flat shading goes after the back-face flip and before normal mapping, so a normal
   *   map perturbs the face normal rather than being replaced by it.
   * - Normal mapping goes before the material's bits, so a bit such as transmission
   *   refracts along the perturbed normal.
   * - Vertex colour goes before the material's bits, which then see the tinted `albedo`.
   *   Metals pick up the tint through `pbrMaterialBit`'s `mix(F0, albedo, metallic)`. A
   *   material sets `vertexColors: false` when its colour attribute carries data.
   * - Billboarding goes before the material's bits and the fog bit. All three may write
   *   `vertexAfterTransform`, and the other two read the `worldPosition` it rebuilds. Its
   *   lit variant also turns the normal, which unlit materials never read.
   * - `alphaOpaqueBit` goes after the material's bits when its `alphaMode` is `'opaque'`. It
   *   writes `fragmentEnd`, so it resets any alpha they wrote in any slot, a raw `descriptor`'s
   *   included. Fog and tone mapping, which follow it in that slot, don't read alpha.
   * - Fog goes before tone mapping. Both write `fragmentEnd`, and fog is scattered light,
   *   so it joins the scene in linear light and goes through the same tone curve.
   * - Every material takes the view's tone bit, which is `null` where the view writes linear
   *   light. A material that sets `_skipsToneCurve`, whose colour the view has curved already,
   *   takes `srgbEncodeBit` in its place.
   * - A colour-space bit goes right after the layout, ahead of every bit that reads colours through
   *   its helpers; `selectColorSpaceBit` picks it. When it picks display space, for an unlit
   *   `colorSpace: 'display'` material that ends in the encode alone with nothing reaching it that
   *   mixes in linear light, no encode goes in and the template scales by `uDisplayExposure`. The
   *   shader then draws the same bytes with no decode or encode.
   * - Only lit materials get a shadow bit, since only they have a light loop calling
   *   `calculateShadow`. It is the real sampler when the mesh receives shadows and a light
   *   in the view has cast one, and `noShadowBit` otherwise.
   * - Lit materials also get `decodeToLinearBit`, which transmission calls to read the opaque copy
   *   back as linear light: the 2.2 decode while the view's tone bit is set, a pass-through while
   *   it isn't.
   * - The pass's `materialBits` (`addPassMaterialBits`), the bit each attached output names for
   *   this pass, go last, so their vertex code reads the final clip position. The shader then takes
   *   the pass's `outputLocations`, so each output lands on the attachment the pass's target has
   *   for it. A material with a template of its own compiles without them, and its draws leave
   *   those textures alone.
   *
   * The material's own bits carry its environment lighting, because those bits read
   * PBR-specific locals. On a mesh with a `TANGENT` attribute, `anisotropyTangentVariant`
   * swaps an anisotropy bit for the variant that reads the vertex tangent instead of
   * deriving one from UVs. The list starts with `globalBitGpu`, so the descriptor turns
   * off `compileShader`'s own prepend of it and keeps the camera bit's.
   * @param mesh - The mesh whose material, geometry and billboard mode pick the bits
   * @param pass - The pass the shader draws in. Its scene-output bits and output locations join
   *   the list, and its `level` then drops every bit above it, which at `'color'` is none. The
   *   bits the list starts with are what every shader on the template needs, so they always stay
   * @param view3d - The view whose fog, tone mapping and shadows join them
   * @param ownDescriptor - The shader a pass with a `level` brings, from the material's entry
   *   for the pass or the pass's own descriptor: its bits go after the level's and are never
   *   dropped, its template is used if it has one, and its overrides win. The `extraBits` of the
   *   material's entry for the pass go last of all
   * @returns `scratchDescriptor`, filled; the next call overwrites it
   */
  private _passShaderDescriptor(
    mesh: Mesh3DData,
    pass: RenderPass,
    view3d: View3D,
    ownDescriptor?: ShaderDescriptor,
  ): ShaderDescriptor {
    const geometry = mesh.geometry;
    const material = mesh.material;
    const fogBit = material.fog ? view3d._fogBit : null;
    const toneBit = view3d._toneMappingBit;
    const vertexColored = !!geometry.attributes.aColor && material.vertexColors;
    const colorSpaceBit = selectColorSpaceBit(material, toneBit, !!fogBit || vertexColored);
    const materialDescriptor = material.getPrimaryDescriptor(view3d);

    const bitsGpu: ShaderBit[] = [globalBitGpu, layoutBit, colorSpaceBit];
    const templateBitCount = bitsGpu.length;

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

    const outputLocations = addPassMaterialBits(bitsGpu, pass, !!materialDescriptor.template);

    const level = pass.level;
    const filtered = level !== undefined && level !== 'color';
    const materialOverrides = materialDescriptor.overrides;
    if (filtered) {
      let kept = templateBitCount;
      for (let i = templateBitCount; i < bitsGpu.length; i++) {
        if (isBitInLevel(bitsGpu[i], level)) bitsGpu[kept++] = bitsGpu[i];
      }
      bitsGpu.length = kept;
    }

    if (ownDescriptor) {
      for (let i = 0; i < ownDescriptor.bitsGpu.length; i++) bitsGpu.push(ownDescriptor.bitsGpu[i]);
    }

    const extraBits = material._passes[pass.bit]?.extraBits;
    if (extraBits) {
      for (let i = 0; i < extraBits.length; i++) bitsGpu.push(extraBits[i]);
    }

    return scratchDescriptor.update({
      bitsGpu,
      template: materialDescriptor.template ?? template,
      overrides: {
        HAS_UVS: geometry.attributes.aUV ? 1 : 0,
        ...(filtered && materialOverrides ? declaredOverrides(materialOverrides, bitsGpu) : materialOverrides),
        ...ownDescriptor?.overrides,
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
    (this._shaderCache as Map<string, { shader: Shader; bindsMaterial: boolean }> | null) = null;
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
