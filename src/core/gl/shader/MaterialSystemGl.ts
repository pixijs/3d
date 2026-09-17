import type { ShaderGroups, WebGLRenderer } from 'pixi.js';
import { ExtensionType, Shader } from 'pixi.js';

import {
  validateMaterialStruct,
  validateMaterialTextureSlots,
} from '../../../materials/utils/validateMaterialTextureSlots';
import type { View3D } from '../../../scene/View3D';
import { MeshPassCache } from '../../batcher/Mesh3DData';
import type { Mesh3DData } from '../../batcher/Mesh3DData';
import { RenderPassBit } from '../../render-passes/RenderPass';
import { assertBitIdentity, assertCameraGroupProvided } from '../../shader/bitRegistry';
import { anisotropyTangentVariant } from '../../shader/bits/anisotropyBit';
import { cameraBit } from '../../shader/bits/cameraBit';
import { doubleSidedNormalBit } from '../../shader/bits/doubleSidedNormalBit';
import { flatShadingBit } from '../../shader/bits/flatShadingBit';
import { instanceFetchMaterialBitGl } from '../../shader/bits/instanceFetchBitGl';
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
import { morphTargetBitGl, morphTargetNormalBitGl } from '../bits/morphTargetBitGl';
import { shadowBitsGl } from '../bits/shadowBitGl';
import { skinningBitGl } from '../bits/skinningBitGl';
import { compileGlslSource } from '../codegen/compileGlslSource';
import type { CompileGlslSourceOptions } from '../codegen/compileGlslSource';
import { Mesh3DBatcherGl } from '../Mesh3DBatcherGl';
import { globalBitGl } from './globalBitGl';
import { materialAccessPluginGl } from './materialAccessPluginGl';
import { packGlBatchKey } from './packGlBatchKey';
import { texturesPluginGl } from './texturesPluginGl';

/** Reusable descriptor — avoids allocating a new one each ensureMaterial call */
const scratchDescriptor = new ShaderDescriptor({});

// Both stages declare every sampler and int highp. GLSL ES defaults `sampler2D` / `samplerCube`
// to lowp and fragment ints to mediump, and mobile drivers such as Mali honour that: store
// fetches come back at half-float precision and packed uint lanes lose bits.

const glVertexTemplate = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp samplerCube;
precision highp sampler2DArray;
precision highp sampler2DArrayShadow;

{{header}}
{{textureGetters}}

void main() {
  mat4 modelMatrix;
  float materialIndex;

  // Mutable locals -- bits modify these before world transform / varying publish.
  // Mirrors the WGSL template so cross-backend bits (uvsBit, uvTransformBit, ...)
  // operate on the same local names.
  vec4 position;
  // Default normal for geometries with no aNormal attribute; normalBit
  // overwrites it in the input slot when the geometry has one.
  vec3 normal = vec3(0.0, 0.0, 1.0);
  vec3 tangent = vec3(0.0);
  vec2 uv = vec2(0.0);

  // Stage 1 — attribute decode + raw input prep.
  {{input}}

  // The material struct, fetched as soon as the input slot has produced
  // vMaterialIndex. Placed ahead of beforeTransform so a bit reading material.X
  // there sees it on WebGL exactly as it does on WebGPU, where material is in
  // scope for the whole vertex function.
  {{materialAccess}}

  // Stage 2 — override values that feed the world/clip transform.
  {{beforeTransform}}

  // Standard transform. GLSL declarations are mutable so afterTransform bits
  // can reassign worldPosition / worldNormal / gl_Position directly.
  vec4 worldPosition = modelMatrix * position;
  // Directions take the rotation/scale block only — translation must not apply.
  // Built after beforeTransform so instancing bits that reassign modelMatrix are
  // picked up.
  mat3 modelMatrix3 = mat3(modelMatrix);

  // A normal transforms by the inverse-transpose — see the WGSL counterpart.
  // Tangents lie along the surface, so they use modelMatrix3 directly.
  vec3 normalScale = 1.0 / vec3(
    dot(modelMatrix3[0], modelMatrix3[0]),
    dot(modelMatrix3[1], modelMatrix3[1]),
    dot(modelMatrix3[2], modelMatrix3[2])
  );
  vec3 worldNormal = modelMatrix3 * (normal * normalScale);
  gl_Position = uViewProjectionMatrix * worldPosition;

  // Stage 3 — modify worldPosition / gl_Position after the transform.
  {{afterTransform}}

  // Stage 4 — finalise locals before varying publish.
  {{end}}

  // Publish varyings once, after end-slot bits have finished mutating locals
  // (uvTransformBit -> uv, future bits may mutate worldNormal/uv/etc).
  vPosition = worldPosition.xyz;
  vNormal   = worldNormal;
  vUV       = uv;
}`;

const glFragmentTemplate = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp samplerCube;
precision highp sampler2DArray;
precision highp sampler2DArrayShadow;

{{header}}

out vec4 fragColor;

{{textureGetters}}

//=============================================================================
// MAIN
//=============================================================================
void main() {
  vec3 normal = normalize(vNormal);
  vec3 albedo = vec3(1.0);
  vec3 finalColor;
  float alpha = 1.0;

  // Per-fragment Material struct, when the compiled schema has fields.
  // Declared here so any bit can reference material.X regardless of its
  // position in the descriptor.
  {{materialAccess}}

  {{material}}

  // Unlit default — picks up modulation from any bit that wrote into albedo.
  // Lighting bits (pbrLightingBit) overwrite finalColor in the lighting slot.
  finalColor = albedo;

  {{lighting}}

  // Linear scene-radiance exposure, applied before any tone-mapping bit's
  // curve runs. Default uExposure = 1.0 makes this a value-preserving op.
  finalColor *= uExposure;

  {{end}}

  // Premultiply for Pixi's default 'normal' blend mode — see WGSL counterpart.
  fragColor = vec4(finalColor * alpha, alpha);
}`;

/**
 * Declares the varyings and attributes every material shader shares, forcing a constant bind
 * group layout across shader variants
 */
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
  name: 'materialStorageBindingGl',
  bindings: {
    global: {
      uMaterialStorage: 'texture_2d<f32>',
    },
  },
};

const template: ShaderBitTemplate = {
  bindGroups: ['global', 'camera', 'batch', 'local'],
  gl: {
    vertex: glVertexTemplate,
    fragment: glFragmentTemplate,
  },
};

/**
 * Manages shader compilation and caching for WebGL 3D materials
 *
 * WebGL counterpart of `MaterialSystemGpu`. Materials provide their bits
 * via `getPrimaryDescriptor()`. The system adds structural bits, infrastructure
 * bits (skinning, shadows), compiles GLSL, and caches by a string key
 * derived from all bit names.
 *
 * Also owns the single `Mesh3DBatcherGl` instance used by all GL
 * render passes.
 *
 * Registered as a WebGL renderer system (`renderer.material3d`); the pipe
 * exposes it to backend-agnostic passes as `pipe.materialSystem`.
 * @internal
 */
export class MaterialSystemGl {
  /** @ignore */
  public static extension = {
    type: [ExtensionType.WebGLSystem],
    name: 'material3d',
  } as const;

  /** Single generic batcher that handles all material types */
  public batcher = new Mesh3DBatcherGl();

  private _destroyed = false;
  private readonly _renderer: WebGLRenderer;

  /** Flat cache: string key → compiled Shader */
  public _shaderCache = new Map<string, Shader>();

  constructor(renderer: WebGLRenderer) {
    this._renderer = renderer;
  }

  /**
   * The WebGL batch key for `item` in pass `bit`
   *
   * Everything a draw command carries that the replay applies once for the whole run — the
   * compiled shader, the render state, and the topology. Meshes agreeing on all of it are
   * interchangeable within one instanced draw; meshes differing in any of it are not, and
   * the run has to break.
   *
   * State is compared by **value**, not identity: `stateFor3D()` hands every material its
   * own `State`, so comparing the objects would put each material in its own draw. The
   * fields are the ones `GlStateSystem` actually applies — `data`'s flags, the blend mode,
   * and `polygonOffset` (which WebGPU's key omits because it ignores it, see #126).
   *
   * Packed rather than hashed or stringified: a key that folds two distinct states together
   * fuses their draws, so every field keeps its own bits. `glBatchKeyBudget.test.ts` pins the
   * widths against pixi's own tables, so a new blend mode or state bit upstream fails a test
   * rather than silently merging draws.
   * @param item - The mesh whose key is computed
   * @param bit - The pass bit indexing `item._passCache`
   * @returns The packed shader + state + topology key
   */
  public computeBatchKey(item: Mesh3DData, bit: number): number {
    const cache = item._passCache[bit];

    return packGlBatchKey(cache.shader.uid, cache.state, cache.topology);
  }

  /**
   * Compiles a standalone shader from a bit list + template (skybox, future screen passes)
   *
   * Prepends the WebGL `globalBitGl` so the shader can read the View3D globals. GLSL only.
   * @param bits - The shader bits to compile
   * @param template - The template supplying the vertex/fragment sources
   * @returns The compiled shader
   */
  public compilePassShader(bits: ShaderBit[], template: ShaderBitTemplate): Shader {
    const gl = compileGlslSource({
      bits: [globalBitGl, cameraBit, ...bits],
      template,
      uboGroups: [],
      useLocations: false,
    });
    return Shader.from({ gl: gl as any, groups: undefined as any, groupMap: gl.groupMap });
  }

  /**
   * Compiles a self-contained shader from a bit list + template (BRDF LUT, IBL prefilter)
   *
   * No `globalBitGl`: the shader binds only what its own bits declare. GLSL only.
   * @param bits - The shader bits to compile
   * @param template - The template supplying the vertex/fragment sources
   * @param groups - The bind groups the template's `bindGroups` declare, keyed by index
   * @returns The compiled shader
   */
  public compileIsolatedShader(bits: ShaderBit[], template: ShaderBitTemplate, groups: ShaderGroups): Shader {
    const gl = compileGlslSource({ bits, template, useLocations: false });
    return Shader.from({ gl, groups, groupMap: gl.groupMap });
  }

  /**
   * Compiles (or returns a cached) GLSL shader from a {@link ShaderDescriptor}
   *
   * Prepends the `globalBitGl` (scene globals) unless the descriptor sets
   * `includeGlobal: false`, and appends mesh-specific infrastructure bits
   * (position decode, morph, skinning), so callers only provide the bits unique to
   * their pass. A pass supplies its own `instanceFetchBitGl` — it declares the store
   * and index textures it reads, which not every template wants.
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
   * @param glslOptions - GLSL-specific compilation options; defaults to the "pass-shader" shape (no UBO groups,
   *   no location attributes), which the main material-shader path also uses
   * @returns The compiled (or cached) shader
   */
  public compileShader(
    descriptor: ShaderDescriptor,
    mesh: Mesh3DData,
    plugins?: ShaderCompilerPlugin[],
    createMaterialSync = false,
    glslOptions: CompileGlslSourceOptions = { uboGroups: [], useLocations: false },
  ): Shader {
    // Scene globals (bind group 0) and the camera bit (group 1) lead the bit list unless the
    // descriptor opts out of each, so `global` keeps its binding slots; the names of the ones
    // included join the key so injected and non-injected variants never alias in cache.
    const finalBits: ShaderBit[] = [];
    let key = '';
    if (descriptor.includeGlobal ?? true) {
      finalBits.push(globalBitGl);
      key += `${globalBitGl.name}|`;
    }
    if (descriptor.includeCamera ?? true) {
      finalBits.push(cameraBit);
      key += `${cameraBit.name}|`;
    }
    finalBits.push(...descriptor.bitsGl);
    key += descriptor.keyGl;
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
    // multiplies the already-morphed position (and normal). Gated on the mesh's
    // Morph object (like `mesh.skeleton`); the delta layout picks the variant off
    // the geometry. Mirrors the WebGPU compose in MaterialSystemGpu.
    if (mesh.morph) {
      if (mesh.geometry.hasMorphNormals) {
        finalBits.push(morphTargetNormalBitGl);
        key += '|morphN';
      } else {
        finalBits.push(morphTargetBitGl);
        key += '|morph';
      }
    }

    if (mesh.skeleton) {
      assertBitIdentity(skinningBitGl);
      finalBits.push(skinningBitGl);
      key += `|${skinningBitGl.name}`;
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
      const gl = compileGlslSource({
        bits: finalBits,
        template: descriptor.template!,
        extraPlugins: plugins,
        ...glslOptions,
        overrides: descriptor.overrides,
      });

      shader = Shader.from({
        gl: gl as any,
        groups: undefined as any,
        overrides: descriptor.overrides,
        groupMap: gl.groupMap,
      });
      this._shaderCache.set(key, shader);
    }

    return shader;
  }

  /**
   * Makes the mesh's material fully resident for this pipe
   *
   * Registers the material in the material store (slot + store reference, so data mutations
   * self-enqueue from then on) and returns a cached shader for its material + feature set,
   * compiling one if it doesn't exist yet. Also attaches the material writer function and writes
   * the shader into `mesh._passCache[..].shader` at the slot determined by `material._passBit`.
   * @param mesh - The mesh whose material is made resident
   * @param view3d - The view supplying tone-mapping/fog/shadow configuration
   * @returns The material's compiled shader
   */
  public ensureMaterial(mesh: Mesh3DData, view3d: View3D): Shader {
    const geo = mesh.geometry;
    const material = mesh.material;

    // The store lives on the pipe (it feeds the pipe's per-frame upload);
    // resolved lazily — pipes are constructed after systems at renderer init.
    this._renderer.renderPipes.view3d.materialStoreBuffer.register(material);
    const passBit = material._passBit & RenderPassBit.MATERIAL_PASS_MASK;

    const pd = material._passes[passBit];
    const materialDescriptor = material.getPrimaryDescriptor(view3d);

    const bitsGl: ShaderBit[] = [globalBitGl, layoutBit, materialStorageBindingBit, instanceFetchMaterialBitGl];

    if (geo.attributes.aNormal) bitsGl.push(normalBit);
    if (geo.attributes.aUV) bitsGl.push(getUvsBit(geo.attributes.aUV.format!));
    if (material.doubleSided) bitsGl.push(doubleSidedNormalBit);

    // After the back-face flip, before normal mapping, so a normal map perturbs
    // the face normal instead of being overwritten by it.
    if (material.flatShading) bitsGl.push(flatShadingBit);

    // Normal mapping variant selection — must come before descriptor bits
    // so that bits like transmissionBit see the perturbed normal for refraction.
    const normalTexture = material.textures.normal;
    if (normalTexture && normalTexture !== NORMAL_MAP && geo.attributes.aUV) {
      bitsGl.push(geo.attributes.aTangent ? tangentNormalMappingBit : normalMappingBit);
    }

    // Auto-inject vertex-color tint when geometry has aColor and the material
    // wants it — see the WebGPU counterpart for why that is a choice. Pushed
    // BEFORE the material's own bits so albedo is pre-multiplied by vColor;
    // pbrMaterialBit then computes `fresnelF0 = mix(F0, albedo, metallic)`
    // against the tinted value, so metals correctly pick up vertex-colour tint.
    if (geo.attributes.aColor && mesh.material.vertexColors) {
      bitsGl.push(vertexColorBit);
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
      bitsGl.push(getMeshBillboardBit(mesh.billboardMode, lit));
    }

    // Env-fill bits (envSource* + iblBit) live inside the material's own
    // `getPrimaryDescriptor(view3d)` — they read PBR-contract variables
    // and so aren't universal across every lit material. Custom lit
    // materials compose their own lighting bits and skip env-fill naturally.
    //
    // Anisotropy's tangent frame is geometry-dependent (like normal mapping):
    // swap in the vertex-tangent variant when the mesh ships a `TANGENT`
    // attribute, else keep the UV-derivative variant. No effect on
    // non-anisotropic materials (the bit isn't present).
    const hasTangent = !!geo.attributes.aTangent;
    for (let i = 0; i < materialDescriptor.bitsGl.length; i++) {
      const bit = materialDescriptor.bitsGl[i];
      bitsGl.push(hasTangent ? anisotropyTangentVariant(bit) : bit);
    }

    // The View's fog bit (linear / exponential / exp2). Added to every material
    // when fog is enabled on the View; materials that own their own distance
    // falloff (skyboxes, water) opt out via `material.fog = false`. Ordered
    // before tone mapping so the mix happens in linear radiance — see the
    // WebGPU counterpart.
    const fogBit = view3d._fogBit;
    if (fogBit && material.fog) bitsGl.push(fogBit);

    // The View's tone-mapping bit. Only the main material pass tone-maps;
    // shadow / depth-only passes go through `compileShader` directly and
    // skip this. Materials opt out via `material.toneMapped = false`.
    const toneBit = view3d._toneMappingBit;
    if (mesh.material.toneMapped && toneBit) bitsGl.push(toneBit);

    // Shadow sampling. Gated on `lit` — unlit shaders have no light loop
    // calling `calculateShadow()`, so both the sampler bit and its no-op
    // stub would be dead code. Within lit materials, the choice between
    // the real sampler and the stub depends on whether the mesh receives
    // shadows.
    if (lit) bitsGl.push(mesh.receiveShadow ? shadowBitsGl[view3d.shadowFilter] : noShadowBit);

    const descriptor = scratchDescriptor.update({
      bitsGl,
      template: materialDescriptor.template ?? template,
      overrides: {
        HAS_UVS: geo.attributes.aUV ? 1 : 0,
        ...materialDescriptor.overrides,
      },
      // bitsGl already leads with globalBitGl; opt out of that prepend (the camera bit still
      // comes from compileShader).
      includeGlobal: false,
    });

    const shader = this.compileShader(
      descriptor,
      mesh,
      [materialStructPackPlugin, materialAccessPluginGl, texturesPluginGl],
      true,
      {
        uboGroups: [],
        useLocations: false,
      },
    );

    const state = (pd && pd.state) || material.state;
    const topology = (pd && pd.topology) || material.topology || geo.topology;
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
   * Releases every cached shader (renderer teardown)
   *
   * Shaders compiled here are exclusive to this system (keyed by bit-name), so they are always
   * freed; the batcher's bind-group cache is module-global and released elsewhere.
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
    interface WebGLSystems {
      /** WebGL 3D material shader compilation/caching + the shared mesh batcher */
      material3d: MaterialSystemGl;
    }
  }
}
