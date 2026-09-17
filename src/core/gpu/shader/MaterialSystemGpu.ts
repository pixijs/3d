import type { ShaderGroups, WebGPURenderer } from 'pixi.js';
import { ExtensionType, Shader } from 'pixi.js';

import {
  validateMaterialStruct,
  validateMaterialTextureSlots,
} from '../../../materials/utils/validateMaterialTextureSlots';
import type { View3D } from '../../../scene/View3D';
import { Mesh3DBatcher } from '../../batcher/Mesh3DBatcher';
import { MeshPassCache } from '../../batcher/Mesh3DData';
import type { Mesh3DData } from '../../batcher/Mesh3DData';
import { RenderPassBit } from '../../render-passes/RenderPass';
import { assertBitIdentity, assertCameraGroupProvided } from '../../shader/bitRegistry';
import { anisotropyTangentVariant } from '../../shader/bits/anisotropyBit';
import { cameraBit } from '../../shader/bits/cameraBit';
import { doubleSidedNormalBit } from '../../shader/bits/doubleSidedNormalBit';
import { flatShadingBit } from '../../shader/bits/flatShadingBit';
import { getMeshBillboardBit } from '../../shader/bits/meshBillboardBits';
import { normalBit } from '../../shader/bits/normalBit';
import { normalMappingBit } from '../../shader/bits/normalMappingBit';
import { noShadowBit } from '../../shader/bits/noShadowBit';
import { getPositionBit } from '../../shader/bits/positionBit';
import { tangentNormalMappingBit } from '../../shader/bits/tangentNormalMappingBit';
import { getUvsBit } from '../../shader/bits/uvsBit';
import { vertexColorBit } from '../../shader/bits/vertexColorBit';
import { materialStructPackPlugin } from '../../shader/codegen/materialStructPackPlugin';
import type { ShaderBit } from '../../shader/ShaderBit';
import type { ShaderBitTemplate } from '../../shader/ShaderBitTemplate';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';
import { ShaderDescriptor } from '../../shader/ShaderDescriptor';
import { NORMAL_MAP } from '../../textures/DefaultTextures';
import { morphTargetBitGpu, morphTargetNormalBitGpu } from '../bits/morphTargetBitGpu';
import { shadowBitsGpu } from '../bits/shadowBitGpu';
import { skinningBitGpu } from '../bits/skinningBitGpu';
import { compileWgslSource } from '../codegen/compileWgslSource';
import { materialStoragePaddingPlugin } from '../codegen/materialStoragePaddingPlugin';
import { globalBitGpu } from './globalBitGpu';
import { texturesPluginGpu } from './texturesPluginGpu';

/** Reusable descriptor — avoids allocating a new one each ensureMaterial call */
const scratchDescriptor = new ShaderDescriptor({});

const gpuTemplate = /*wgsl*/ `


{{header}}
{{textureGetters}}
{{vertexHeader}}

//=============================================================================
// VERTEX SHADER
//=============================================================================
@vertex
fn mainVertex(input: VertexInput,
  @builtin(instance_index) ii: u32,
  @builtin(vertex_index) vid: u32
) -> VertexOutput {
  var output: VertexOutput;

  var position: vec4<f32>;
  // Default normal for geometries with no aNormal attribute; normalBit
  // overwrites it in the input slot when the geometry has one.
  var normal = vec3<f32>(0.0, 0.0, 1.0);
  var tangent = vec3<f32>(0.0);
  var uv = vec2<f32>(0.0);
  
  let inst = uRenderableInstanceStorage[ii];
  let renderable = uRenderableStorage[inst.id];
  let textureSlots = inst.texSlots;
  let material = uMaterialStorage[renderable.materialIndex];

  // Vertex-stage texture reads (displacement bits) go through the same
  // sampleXxxDirect helpers as the fragment stage, and those read this private.
  // WebGL gets it for free — vTextureSlots is a varying written in the vertex
  // stage — so without this line the two backends silently disagree.
  _textureSlots = textureSlots;

  let batchWorldMatrix = uRenderableStorage[0].transform;
  var modelMatrix = batchWorldMatrix * renderable.transform;

  // Stage 1 — attribute decode + raw input prep.
  // positionBit, skinningBit, uvsBit, tangent decode live here.
  {{vertexInput}}

  // Stage 2 — override values that feed the world/clip transform.
  // Billboards, vertex displacement, custom skinning fallbacks.
  {{vertexBeforeTransform}}

  // Standard transform. worldPosition / worldNormal / clipPosition are vars
  // so afterTransform bits can reassign them.
  var worldPosition = modelMatrix * position;
  // Directions take the rotation/scale block only — translation must not apply.
  // Built after beforeTransform so instancing bits that reassign modelMatrix are
  // picked up.
  let modelMatrix3 = mat3x3<f32>(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz);

  // A normal transforms by the inverse-transpose, not by the matrix itself:
  // non-uniform scale has to tilt it *away* from the stretched axis, not into
  // it. Dividing by each column's squared length first is exactly that for any
  // rotation-and-scale matrix, at three dot products instead of an inverse.
  // Tangents lie along the surface, so they use modelMatrix3 directly.
  let normalScale = 1.0 / vec3<f32>(
    dot(modelMatrix3[0], modelMatrix3[0]),
    dot(modelMatrix3[1], modelMatrix3[1]),
    dot(modelMatrix3[2], modelMatrix3[2])
  );
  var worldNormal = modelMatrix3 * (normal * normalScale);
  var clipPosition = camera.uViewProjectionMatrix * worldPosition;

  // Stage 3 — modify worldPosition / clipPosition after the standard transform.
  // Depth bias, projection tricks.
  {{vertexAfterTransform}}

  // Stage 4 — modify the locals the template is about to publish as varyings.
  {{vertexEnd}}

  // Publish varyings once, after end-slot bits have finished mutating locals
  // (uvTransformBit -> uv, future bits may mutate worldNormal/uv/etc).
  // NOTE: vMaterialIndex is u32, so it must be flat-interpolated in WGSL.
  output.position       = clipPosition;
  output.vPosition      = worldPosition.xyz;
  output.vNormal        = worldNormal;
  output.vUV            = uv;
  output.vMaterialIndex = renderable.materialIndex;
  output.vTextureSlots  = textureSlots;

  return output;
}

//=============================================================================
// FRAGMENT SHADER - MAIN
//=============================================================================
@fragment
fn mainFragment(input: FragmentInput) -> @location(0) vec4<f32> {
  _textureSlots = input.vTextureSlots;
  var normal = normalize(input.vNormal);
  var albedo: vec3<f32> = vec3<f32>(1.0);
  var finalColor: vec3<f32>;
  var alpha: f32 = 1.0;

  // Per-fragment Material struct. Declared here so any bit can reference
  // material.X regardless of its position in the descriptor.
  var material = uMaterialStorage[input.vMaterialIndex];

  {{fragmentMaterial}}

  // Unlit default — picks up modulation from any bit that wrote into albedo.
  // Lighting bits (pbrLightingBit) overwrite finalColor in the lighting slot.
  finalColor = albedo;

  {{fragmentLighting}}

  // Linear scene-radiance exposure, applied before any tone-mapping bit's
  // curve runs. Default uExposure = 1.0 makes this a value-preserving op.
  finalColor *= global.uExposure;

  {{fragmentEnd}}

  // Premultiply for Pixi's default 'normal' blend mode (SRC + DST*(1-α)).
  // Source textures stay non-premultiplied (matching the 2D convention) and
  // we bridge the gap here, so transparent 3D materials don't need a custom
  // blendMode. See follow-up issue for the full premul-pipeline discussion.
  return vec4<f32>(finalColor * alpha, alpha);
}
`;

/** Defines the shader's layout — forces a constant bind-group layout across material variants */
const layoutBit: ShaderBit = {
  name: 'layout',
  overrideDefs: {
    HAS_UVS: { type: 'u32', required: true },
  },
  interStage: {
    vNormal: 'vec3<f32>',
    vUV: 'vec2<f32>',
    vPosition: 'vec3<f32>',
    vMaterialIndex: 'u32',
    vTextureSlots: 'u32',
  },
};

const materialStorageBindingBit: ShaderBit = {
  name: 'materialStorageBinding',
  bindings: {
    global: {
      uMaterialStorage: 'storage<Material>',
    },
  },
};

const template: ShaderBitTemplate = {
  bindGroups: ['global', 'camera', 'batch'],
  gpu: gpuTemplate,
};

/**
 * Manages shader compilation and caching for WebGPU 3D materials
 *
 * Materials provide their shader bits via `getPrimaryDescriptor()`. The system
 * adds structural bits (layout, UVs), infrastructure bits (skinning, shadows),
 * compiles once, and caches by a string key derived from all bit names.
 *
 * Also owns the single `Mesh3DBatcher` instance used by all render
 * passes — there's no per-material-type batcher, the generic batcher handles
 * everything via the flat `material._textures` array.
 *
 * Registered as a WebGPU renderer system (`renderer.material3d`); the pipe
 * exposes it to backend-agnostic passes as `pipe.materialSystem`.
 * @internal
 */
export class MaterialSystemGpu {
  /** @ignore */
  public static extension = {
    type: [ExtensionType.WebGPUSystem],
    name: 'material3d',
  } as const;

  /** Single generic batcher that handles all material types */
  public batcher = new Mesh3DBatcher();

  private _destroyed = false;
  private readonly _renderer: WebGPURenderer;
  /** Flat cache: string key → compiled Shader */
  public _shaderCache = new Map<string, Shader>();

  constructor(renderer: WebGPURenderer) {
    this._renderer = renderer;
  }

  /**
   * The WebGPU batch key for `item` in pass `bit`: the full graphics-pipeline
   * key (program + state + topology + overrides)
   *
   * Read on the per-dirty-mesh path by `RenderPass.onRenderableDirty`; `_passCache[bit]` is
   * pre-populated by `ensureMaterial`.
   * @param item - The mesh to key
   * @param bit - The render pass bit whose cache entry holds the shader and state
   */
  public computeBatchKey(item: Mesh3DData, bit: number): number {
    const cache = item._passCache[bit];
    return this._renderer.pipeline.getPipelineKey(
      item.geometry,
      cache.shader.gpuProgram!,
      cache.state,
      cache.topology,
      cache.shader._overrides || Object.create(null),
    );
  }

  /**
   * Compile a standalone shader from a bit list + template (skybox, future screen passes),
   * prepending the WebGPU `globalBitGpu` so it can read the View3D globals
   *
   * WGSL only — the shader only ever runs on a WebGPU renderer.
   * @param bits - The shader bits to compile, after the globals
   * @param template - The template supplying the vertex/fragment sources
   */
  public compilePassShader(bits: ShaderBit[], template: ShaderBitTemplate): Shader {
    return Shader.from({ gpu: compileWgslSource({ bits: [globalBitGpu, cameraBit, ...bits], template }) });
  }

  /**
   * Compile a self-contained shader from a bit list + template (BRDF LUT, IBL prefilter)
   *
   * No `globalBitGpu`: the shader binds only what its own bits declare. WGSL only.
   * @param bits - The shader bits to compile
   * @param template - The template supplying the vertex/fragment sources
   * @param groups - The bind groups the template's `bindGroups` declare, keyed by index
   * @returns The compiled shader
   */
  public compileIsolatedShader(bits: ShaderBit[], template: ShaderBitTemplate, groups: ShaderGroups): Shader {
    return Shader.from({ gpu: compileWgslSource({ bits, template }), groups });
  }

  /**
   * Compiles (or returns a cached) shader from a {@link ShaderDescriptor}
   *
   * Prepends the `globalBitGpu` (scene globals at bind group 0) unless the
   * descriptor sets `includeGlobal: false`, and appends mesh-specific
   * infrastructure bits (skinning, morph targets in the future), so callers
   * only provide the bits unique to their pass.
   *
   * When `createMaterialSync` is true, a sync function is also created
   * from the compiled Material struct and attached to `mesh.material`.
   *
   * Use this for custom render passes that need their own shader variant.
   * For the main material shader, use `ensureMaterial` instead.
   * @param descriptor - The shader descriptor containing bits, template, and overrides
   * @param mesh - The mesh to compile for (used for skeleton detection and sync function)
   * @param plugins - Additional compiler plugins to run during compilation (e.g. batch textures)
   * @param createMaterialSync - When true, generates a sync function to serialise material properties to GPU
   */
  public compileShader(
    descriptor: ShaderDescriptor,
    mesh: Mesh3DData,
    plugins?: ShaderCompilerPlugin[],
    createMaterialSync?: boolean,
  ): Shader {
    // Scene globals (bind group 0) and the camera bit (group 1) lead the bit list unless the
    // descriptor opts out of each, so `global` keeps its binding slots; the names of the ones
    // included join the key so injected and non-injected variants never alias in cache.
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
    assertCameraGroupProvided(finalBits, descriptor.template!);

    // Position bit must run before skinning so the skin matrix multiplies
    // dequantized positions. For KHR_mesh_quantization formats (snorm/unorm) the
    // bit applies the normalization divisor; for float formats the multiply is a
    // no-op. Either way, downstream bits see the same integer-space value.
    //
    // Appended bits aren't part of the descriptor, so their (registry-verified)
    // names join the key here — `position:<format>` carries the variant.
    const positionBit = getPositionBit(mesh.geometry.attributes.aPosition.format!);
    assertBitIdentity(positionBit);
    finalBits.push(positionBit);
    key += `|${positionBit.name}`;

    // Morph runs after position decode and before skinning, so the skin matrix
    // multiplies the already-morphed position (and normal). Presence of the mesh's
    // Morph object is the gate (like `mesh.skeleton` for skinning); the delta
    // layout — positions-only vs position+normal texel pairs — picks the variant
    // off the shared geometry. The loop is count-driven, so no per-count permutation.
    if (mesh.morph) {
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

    // Material shaders pack textures from `material._textures` by position;
    // the compiled sampleX indices walk these bits' `textures` declarations.
    // Verify the two line up before the shader can render wrong (covers the
    // cache-hit path too — the check is on the material, not the shader).
    if (createMaterialSync) {
      validateMaterialTextureSlots(finalBits, mesh.material);
      validateMaterialStruct(finalBits, mesh.material);
    }

    let shader = this._shaderCache.get(key);

    if (!shader) {
      const gpu = compileWgslSource({
        bits: finalBits,
        template: descriptor.template!,
        extraPlugins: plugins,
      });

      shader = Shader.from({ gpu, overrides: descriptor.overrides });
      this._shaderCache.set(key, shader);
    }

    return shader;
  }

  /**
   * Makes the mesh's material fully resident for this pipe
   *
   * Registers it in the material store (slot + store reference, so data mutations
   * self-enqueue from then on) and returns a cached shader for its
   * material + feature set, compiling one if it doesn't exist yet. Also
   * attaches the material writer function and writes the shader into
   * `mesh._passCache[..].shader` at the slot determined by `material._passBit`.
   * @param mesh - The mesh whose material becomes resident
   * @param view3d - The view the mesh renders in; picks the material's primary descriptor
   */
  public ensureMaterial(mesh: Mesh3DData, view3d: View3D): Shader {
    const geometry = mesh.geometry;
    const material = mesh.material;

    // The store lives on the pipe (it feeds the pipe's per-frame upload);
    // resolved lazily — pipes are constructed after systems at renderer init.
    this._renderer.renderPipes.view3d.materialStoreBuffer.register(material);
    const passBit = material._passBit & RenderPassBit.MATERIAL_PASS_MASK;

    const pd = material._passes[passBit];
    const materialDescriptor = material.getPrimaryDescriptor(view3d);

    const bitsGpu: ShaderBit[] = [globalBitGpu, layoutBit, materialStorageBindingBit];

    if (geometry.attributes.aNormal) bitsGpu.push(normalBit);
    if (geometry.attributes.aUV) bitsGpu.push(getUvsBit(geometry.attributes.aUV.format!));
    if (material.doubleSided) bitsGpu.push(doubleSidedNormalBit);

    // After the back-face flip, before normal mapping, so a normal map perturbs
    // the face normal instead of being overwritten by it.
    if (material.flatShading) bitsGpu.push(flatShadingBit);

    // Normal mapping variant selection — must come before descriptor bits
    // so that bits like transmissionBit see the perturbed normal for refraction.
    const normalTexture = material.textures.normal;

    if (normalTexture && normalTexture !== NORMAL_MAP && geometry.attributes.aUV) {
      bitsGpu.push(geometry.attributes.aTangent ? tangentNormalMappingBit : normalMappingBit);
    }

    // Auto-inject vertex-color tint when geometry has aColor and the material
    // wants it — `vertexColors: false` is the escape hatch for pipelines that
    // use the color set to carry data rather than colour. Pushed BEFORE the
    // material's own bits so albedo is pre-multiplied by vColor; pbrMaterialBit
    // then computes `fresnelF0 = mix(F0, albedo, metallic)` against the tinted
    // value, so metals correctly pick up vertex-colour tint.
    if (geometry.attributes.aColor && mesh.material.vertexColors) {
      bitsGpu.push(vertexColorBit);
    }

    const lit = mesh.material.lit;

    // Billboarding, injected from mesh state like skinning and morph targets, so it
    // composes with any material rather than being welded to one.
    //
    // Must be pushed before the material's own bits and before the fog bit below:
    // all three write the vertex `afterTransform` slot, contributions concatenate in
    // bit-list order, and both of those read the worldPosition this one rebuilds.
    //
    // The `lit` variant additionally rotates the normal into the billboard basis;
    // unlit materials never read vNormal, so they compile without it.
    if (mesh.billboardMode !== 'none') {
      bitsGpu.push(getMeshBillboardBit(mesh.billboardMode, lit));
    }

    // Env-fill bits (envSource* + iblBit) live inside the material's own
    // `getPrimaryDescriptor(view3d)` — they read PBR-contract variables
    // (`roughness` / `metallic` / `fresnelF0` / `f90` / `ambient`) and so
    // aren't universal across every lit material. Custom lit materials
    // compose their own lighting bits and skip env-fill naturally.
    //
    // Anisotropy's tangent frame is geometry-dependent (like normal mapping):
    // when the mesh ships a `TANGENT` attribute, swap in the vertex-tangent
    // variant for a smooth frame; otherwise keep the UV-derivative variant the
    // material constructed with. This adds no work for non-anisotropic
    // materials (the bit isn't present) and reuses the tangent the loader reads.
    const hasTangent = !!geometry.attributes.aTangent;
    for (let i = 0; i < materialDescriptor.bitsGpu.length; i++) {
      const bit = materialDescriptor.bitsGpu[i];
      bitsGpu.push(hasTangent ? anisotropyTangentVariant(bit) : bit);
    }

    // The View's fog bit (linear / exponential / exp2). Added to every material
    // when fog is enabled on the View; materials that own their own distance
    // falloff (skyboxes, water) opt out via `material.fog = false`.
    //
    // Ordered before tone mapping deliberately: both bits write the `end`
    // slot, and fog is scattered light, so it has to join the scene in linear
    // radiance and be shaped by the same curve.
    const fogBit = view3d._fogBit;
    if (fogBit && material.fog) bitsGpu.push(fogBit);

    // The View's tone-mapping bit. Only the main material pass tone-maps;
    // shadow / depth-only passes go through `compileShader` directly and
    // skip this. Materials opt out via `material.toneMapped = false`.
    const toneBit = view3d._toneMappingBit;
    if (mesh.material.toneMapped && toneBit) bitsGpu.push(toneBit);

    // Shadow sampling. Gated on `lit` — unlit shaders have no light loop
    // calling `calculateShadow()`, so both the sampler bit and its no-op
    // stub would be dead code. Within lit materials, the choice between
    // the real sampler and the stub depends on whether the mesh receives
    // shadows.
    if (lit) bitsGpu.push(mesh.receiveShadow ? shadowBitsGpu[view3d.shadowFilter] : noShadowBit);

    const descriptor = scratchDescriptor.update({
      bitsGpu,
      template: materialDescriptor.template ?? template,
      overrides: {
        HAS_UVS: geometry.attributes.aUV ? 1 : 0,
        ...materialDescriptor.overrides,
      },
      // bitsGpu already leads with globalBitGpu; opt out of that prepend (the camera bit still
      // comes from compileShader).
      includeGlobal: false,
    });

    // Pack must precede padding (preCompile runs in array order) so `_pad`
    // is computed from the packed layout and stays last.
    const shader = this.compileShader(
      descriptor,
      mesh,
      [materialStructPackPlugin, materialStoragePaddingPlugin, texturesPluginGpu],
      true,
    );

    const state = (pd && pd.state) || material.state;
    const topology = (pd && pd.topology) || material.topology || geometry.topology;
    const cache = mesh._passCache[passBit];
    if (!cache) {
      mesh._passCache[passBit] = new MeshPassCache(shader, state, topology);
    } else {
      cache.shader = shader;
      cache.state = state;
      cache.topology = topology;
    }

    return shader;
  }

  /**
   * Destroy every cached material shader and reset the cache (renderer teardown)
   *
   * `shader.destroy()` keeps the default `destroyPrograms = false`: the WebGPU
   * `GpuProgram` cache is shared with pixi's 2D program cache and is not ours to
   * free. The `Mesh3DBatcher` owns no exclusive teardown of its own (its
   * WebGPU bind-group cache is module-global and released elsewhere).
   */
  public destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    for (const shader of this._shaderCache.values()) shader.destroy();
    this._shaderCache.clear();
  }
}

declare global {
  namespace PixiMixins {
    interface WebGPUSystems {
      /** WebGPU 3D material shader compilation/caching + the shared mesh batcher */
      material3d: MaterialSystemGpu;
    }
  }
}
