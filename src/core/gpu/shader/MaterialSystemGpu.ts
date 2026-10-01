import type { ShaderGroups, WebGPURenderer } from 'pixi.js';
import { DOMAdapter, ExtensionType, Shader } from 'pixi.js';

import {
  getMaterialLayout,
  validateMaterialStruct,
  validateMaterialTextureSlots,
} from '../../../materials/utils/validateMaterialTextureSlots';
import type { MaterialLayout } from '../../../materials/utils/validateMaterialTextureSlots';
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
import { materialTextureAccessPlugin } from '../codegen/materialTextureAccessPlugin';
import { globalBitGpu } from './globalBitGpu';
import { createTexturesPluginGpu, prefersSelectSampler } from './texturesPluginGpu';

/** Reused by every `ensureMaterial` call, so resolving a material allocates no descriptor */
const scratchDescriptor = new ShaderDescriptor({});

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
 * The vertex stage sets the private `_textureSlots` the texture getters read, as the fragment stage
 * does from `vTextureSlots`, so a displacement bit can sample with `sampleXDirect`. WebGL's getters
 * read `vTextureSlots` itself, which its vertex stage has already written.
 *
 * The fragment stage declares `material` before any slot, so every bit can read it. `finalColor`
 * starts as `albedo`, the unlit result, and lighting bits overwrite it in `fragmentLighting`. It
 * is multiplied by `uExposure` before `fragmentEnd`, where fog and tone mapping run, and returned
 * premultiplied by alpha for pixi's default `normal` blend mode. Textures stay straight alpha, as
 * they are in 2D, so a transparent material needs no blend mode of its own.
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
  let textureSlots = inst.texSlots;
  let vMaterialIndex = renderable.materialIndex;
  {{vertexMaterialAccess}}

  _textureSlots = textureSlots;

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
  output.vTextureSlots  = textureSlots;

  return output;
}

@fragment
fn mainFragment(input: FragmentInput) -> @location(0) vec4<f32> {
  _textureSlots = input.vTextureSlots;
  var normal = normalize(input.vNormal);
  var albedo: vec3<f32> = vec3<f32>(1.0);
  var finalColor: vec3<f32>;
  var alpha: f32 = 1.0;

  let vMaterialIndex = input.vMaterialIndex;
  {{fragmentMaterialAccess}}

  {{fragmentMaterial}}

  finalColor = albedo;

  {{fragmentLighting}}

  finalColor *= global.uExposure;

  {{fragmentEnd}}

  return vec4<f32>(finalColor * alpha, alpha);
}
`;

/** The varyings the material template writes and its `HAS_UVS` override, declared for every material variant */
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

const template: ShaderBitTemplate = {
  bindGroups: ['global', 'camera', 'batch'],
  gpu: gpuTemplate,
};

/**
 * Manages shader compilation and caching for WebGPU 3D materials
 *
 * Materials provide their shader bits via `getPrimaryDescriptor()`. The system
 * adds the bits that depend on the mesh and view (normals, UVs, normal mapping,
 * skinning, morphing, fog, tone mapping, shadows), compiles once, and caches by
 * a string key derived from all bit names.
 *
 * Also owns the one `Mesh3DBatcher` every render pass uses; it handles every
 * material type through the flat `material._textures` array.
 *
 * Registered as a WebGPU renderer system, `renderer.material3d`, which is how
 * the backend-neutral passes and the scene update reach it.
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
  /** Flat cache: string key → compiled Shader, with the material layout its bits declare */
  public _shaderCache = new Map<string, { shader: Shader; layout: MaterialLayout }>();
  /** Material compiler plugins, chosen for this renderer's GPU; built on first use, once the adapter exists */
  private _materialPlugins: ShaderCompilerPlugin[] | null = null;

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
   * Compile a standalone shader from a bit list + template (the background pass, post effects),
   * prepending the WebGPU `globalBitGpu` and the camera bit so it can read the View3D globals
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
   * Prepends `globalBitGpu` (scene globals at group 0) and the camera bit (group 1)
   * unless the descriptor sets `includeGlobal: false` or `includeCamera: false`, and
   * appends the mesh's position, morph and skinning bits, so callers only provide
   * the bits unique to their pass. The position bit goes before the other two so
   * they see dequantized positions, and morphing before skinning so the skin moves
   * the morphed vertex. The bits added here aren't in the descriptor's key, so their
   * names join the cache key, and variants with and without them never share an entry.
   *
   * With `validateMaterial`, the material's texture slots and struct are checked
   * against the layout the bits declare, before a wrong match can render. The check
   * reads the material, so it runs on cache hits too.
   *
   * Use this for custom render passes that need their own shader variant.
   * For the main material shader, use `ensureMaterial` instead.
   * @param descriptor - The shader descriptor containing bits, template, and overrides
   * @param mesh - The mesh to compile for; its geometry and morph and skinning state pick the appended bits
   * @param plugins - Additional compiler plugins to run during compilation (e.g. batch textures)
   * @param validateMaterial - Whether to check the mesh's material against the layout the bits declare
   */
  public compileShader(
    descriptor: ShaderDescriptor,
    mesh: Mesh3DData,
    plugins?: ShaderCompilerPlugin[],
    validateMaterial?: boolean,
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
    assertCameraGroupProvided(finalBits, descriptor.template!);

    const positionBit = getPositionBit(mesh.geometry.attributes.aPosition.format!);
    assertBitIdentity(positionBit);
    finalBits.push(positionBit);
    key += `|${positionBit.name}`;

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

    const cached = this._shaderCache.get(key);
    const layout = cached?.layout ?? getMaterialLayout(finalBits);

    if (validateMaterial) {
      validateMaterialTextureSlots(layout, mesh.material);
      validateMaterialStruct(layout, mesh.material);
    }

    if (cached) return cached.shader;

    const gpu = compileWgslSource({
      bits: finalBits,
      template: descriptor.template!,
      extraPlugins: plugins,
    });

    const shader = Shader.from({ gpu, overrides: descriptor.overrides });
    this._shaderCache.set(key, { shader, layout });

    return shader;
  }

  /**
   * Makes the mesh's material resident and returns the shader its main pass draws with
   *
   * Registers the material in the pipe's material store, which gives it a row and makes
   * its data changes queue themselves for upload from then on. The store is looked up
   * through `renderer.renderPipes` on each call, not held, because the renderer builds
   * its pipes after its systems. Then builds the bit list, compiles it or takes the
   * cached shader, and writes the shader, state and topology into `mesh._passCache` at
   * the material's pass bit; `PassDescriptor` says how state and topology resolve.
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
   * - Fog goes before tone mapping. Both write `fragmentEnd`, and fog is scattered light,
   *   so it joins the scene in linear light and goes through the same tone curve.
   * - Only lit materials get a shadow bit, since only they have a light loop calling
   *   `calculateShadow`. It is the real sampler when the mesh receives shadows and a light
   *   in the view has cast one, and `noShadowBit` otherwise.
   *
   * The material's own bits carry its environment lighting, because those bits read
   * PBR-specific locals. On a mesh with a `TANGENT` attribute, `anisotropyTangentVariant`
   * swaps an anisotropy bit for the variant that reads the vertex tangent instead of
   * deriving one from UVs. The list starts with `globalBitGpu`, so the descriptor turns
   * off `compileShader`'s own prepend of it and keeps the camera bit's.
   * @param mesh - The mesh whose material becomes resident
   * @param view3d - The view the mesh renders in; picks the material's primary descriptor
   */
  public ensureMaterial(mesh: Mesh3DData, view3d: View3D): Shader {
    const geometry = mesh.geometry;
    const material = mesh.material;

    this._renderer.renderPipes.view3d.materialStoreBuffer.register(material);
    const passBit = material._passBit & RenderPassBit.MATERIAL_PASS_MASK;

    const pd = material._passes[passBit];
    const materialDescriptor = material.getPrimaryDescriptor(view3d);

    const bitsGpu: ShaderBit[] = [globalBitGpu, layoutBit];

    if (geometry.attributes.aNormal) bitsGpu.push(normalBit);
    if (geometry.attributes.aUV) bitsGpu.push(getUvsBit(geometry.attributes.aUV.format!));
    if (material.doubleSided) bitsGpu.push(doubleSidedNormalBit);

    if (material.flatShading) bitsGpu.push(flatShadingBit);

    const normalTexture = material.textures.normal;

    if (normalTexture && normalTexture !== NORMAL_MAP && geometry.attributes.aUV) {
      bitsGpu.push(geometry.attributes.aTangent ? tangentNormalMappingBit : normalMappingBit);
    }

    if (geometry.attributes.aColor && mesh.material.vertexColors) {
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

    const fogBit = view3d._fogBit;
    if (fogBit && material.fog) bitsGpu.push(fogBit);

    const toneBit = view3d._toneMappingBit;
    if (mesh.material.toneMapped && toneBit) bitsGpu.push(toneBit);

    if (lit) {
      bitsGpu.push(mesh.receiveShadow && view3d._hasShadows ? shadowBitsGpu[view3d.shadowFilter] : noShadowBit);
    }

    const descriptor = scratchDescriptor.update({
      bitsGpu,
      template: materialDescriptor.template ?? template,
      overrides: {
        HAS_UVS: geometry.attributes.aUV ? 1 : 0,
        ...materialDescriptor.overrides,
      },
      includeGlobal: false,
    });

    const shader = this.compileShader(descriptor, mesh, this._getMaterialPlugins(), true);

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

  private _getMaterialPlugins(): ShaderCompilerPlugin[] {
    if (!this._materialPlugins) {
      const preferSelect = prefersSelectSampler({
        adapter: this._renderer.gpu.adapter.info,
        antialias: this._renderer.view.texture.source.antialias,
        userAgent: DOMAdapter.get().getNavigator().userAgent,
      });

      this._materialPlugins = [
        materialStructPackPlugin,
        materialTextureAccessPlugin,
        createTexturesPluginGpu(preferSelect ? 'select' : 'branch'),
      ];
    }

    return this._materialPlugins;
  }

  /**
   * Destroy every cached material shader and reset the cache (renderer teardown)
   *
   * `shader.destroy()` keeps the default `destroyPrograms = false`: the WebGPU
   * `GpuProgram` cache is shared with pixi's 2D program cache and is not ours to
   * free. The `Mesh3DBatcher` holds no GPU resources; the batch bind groups it fills
   * belong to each draw list's `DrawCommandList`.
   */
  public destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    for (const { shader } of this._shaderCache.values()) shader.destroy();
    this._shaderCache.clear();
    this._materialPlugins = null;
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
