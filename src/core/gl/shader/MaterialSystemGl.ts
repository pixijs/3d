import type { ShaderGroups, WebGLRenderer } from 'pixi.js';
import { ExtensionType, Shader } from 'pixi.js';

import {
  getMaterialLayout,
  validateMaterialStruct,
  validateMaterialTextureSlots,
} from '../../../materials/utils/validateMaterialTextureSlots';
import type { MaterialLayout } from '../../../materials/utils/validateMaterialTextureSlots';
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
import { materialTextureAccessPluginGl } from '../codegen/materialTextureAccessPluginGl';
import { Mesh3DBatcherGl } from '../Mesh3DBatcherGl';
import { globalBitGl } from './globalBitGl';
import { packGlBatchKey } from './packGlBatchKey';
import { texturesPluginGl } from './texturesPluginGl';

/** Reused by every `ensureMaterial` call rather than allocating a descriptor each time */
const scratchDescriptor = new ShaderDescriptor({});

/**
 * The WebGL forward vertex template, mirroring the WGSL one in `MaterialSystemGpu` so bits written
 * for both backends work on the same local names
 *
 * Bits fill four slots in order. `{{input}}` decodes attributes into `position`, `normal`, `tangent`
 * and `uv`, and the instance fetch sets `modelMatrix` and `vMaterialIndex` there.
 * `{{beforeTransform}}` changes what feeds the world and clip transform, `{{afterTransform}}`
 * changes `worldPosition`, `worldNormal` or `gl_Position`, and `{{end}}` finishes the locals
 * before they're published as varyings. `{{materialAccess}}` declares `material` right after
 * `{{input}}`, so a bit in `beforeTransform` reads it as it would on WebGPU, where `material` is in
 * scope for the whole function.
 *
 * `normal` defaults to +Z for a geometry without normals, and `normalBit` overwrites it. The world
 * normal takes the inverse-transpose of the model matrix's 3×3 part, worked out by dividing by
 * each column's squared length: that is exact for a rotation-and-scale matrix and costs three dot
 * products instead of an inverse. Tangents lie along the surface and take the 3×3 part as it is.
 * `modelMatrix3` is built after `beforeTransform`, so an instancing bit that reassigns
 * `modelMatrix` there is picked up.
 */
const glVertexTemplate = `#version 300 es

{{header}}
{{textureGetters}}

void main() {
  mat4 modelMatrix;
  float materialIndex;

  vec4 position;
  vec3 normal = vec3(0.0, 0.0, 1.0);
  vec3 tangent = vec3(0.0);
  vec2 uv = vec2(0.0);

  {{input}}

  {{materialAccess}}

  {{beforeTransform}}

  vec4 worldPosition = modelMatrix * position;
  mat3 modelMatrix3 = mat3(modelMatrix);

  vec3 normalScale = 1.0 / vec3(
    dot(modelMatrix3[0], modelMatrix3[0]),
    dot(modelMatrix3[1], modelMatrix3[1]),
    dot(modelMatrix3[2], modelMatrix3[2])
  );
  vec3 worldNormal = modelMatrix3 * (normal * normalScale);
  gl_Position = uViewProjectionMatrix * worldPosition;

  {{afterTransform}}

  {{end}}

  vPosition = worldPosition.xyz;
  vNormal   = worldNormal;
  vUV       = uv;
}`;

/**
 * The WebGL forward fragment template, mirroring the WGSL one in `MaterialSystemGpu`
 *
 * `material` is declared before any bit runs, so a bit reads `material.X` wherever it sits in the
 * descriptor. `finalColor` starts as `albedo`, the unlit result, which a lighting bit overwrites in
 * `{{lighting}}`. `uExposure`, 1 unless the view sets it, scales the linear result before
 * `{{end}}`, where fog and tone mapping run. Shading works in straight alpha, so the output is
 * premultiplied here for pixi's default `'normal'` blend, `src + dst * (1 - srcAlpha)`, and a
 * transparent material needs no blend mode of its own.
 */
const glFragmentTemplate = `#version 300 es

{{header}}

out vec4 fragColor;

{{textureGetters}}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 albedo = vec3(1.0);
  vec3 finalColor;
  float alpha = 1.0;

  {{materialAccess}}

  {{material}}

  finalColor = albedo;

  {{lighting}}

  finalColor *= uExposure;

  {{end}}

  fragColor = vec4(finalColor * alpha, alpha);
}`;

/**
 * Declares the varyings both templates publish and the required `HAS_UVS` override, so every
 * material variant agrees on them
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
 * bits (skinning, shadows), compiles GLSL, and caches by a key built from the
 * bit names and override values.
 *
 * Also owns the single `Mesh3DBatcherGl` instance used by all GL
 * render passes.
 *
 * Registered as a WebGL renderer system; passes reach it as `pipe.renderer.material3d`.
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

  /** Compiled shaders by cache key, each with the material layout its bits declare */
  public _shaderCache = new Map<string, { shader: Shader; layout: MaterialLayout }>();

  constructor(renderer: WebGLRenderer) {
    this._renderer = renderer;
  }

  /**
   * The WebGL pipeline key for `item` in pass `bit`, which `updateMesh3DKeys` combines with the
   * geometry into the mesh's batch key
   *
   * Covers what a draw command applies once for its whole run: the compiled shader, the render
   * state and the topology. Meshes that differ in any of it can't share an instanced draw.
   *
   * State is compared by **value**, not identity: `stateFor3D()` hands every material its
   * own `State`, so comparing the objects would put each material in its own draw. The
   * fields are the ones pixi's `GlStateSystem` applies: `data`'s flags, the blend mode,
   * and `polygonOffset`, which WebGPU's key leaves out because WebGPU ignores it (#126).
   * `packGlBatchKey` packs them without folding any two together.
   * @param item - The mesh whose key is computed
   * @param bit - The pass bit indexing `item._passCache`
   * @returns The packed shader + state + topology key
   */
  public computeBatchKey(item: Mesh3DData, bit: number): number {
    const cache = item._passCache[bit];

    return packGlBatchKey(cache.shader.uid, cache.state, cache.topology);
  }

  /**
   * Compiles a standalone shader from a bit list + template (background, output, full-screen effects)
   *
   * Prepends `globalBitGl` and `cameraBit`, so the shader can read the view's globals and camera.
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
   * No `globalBitGl`: the shader binds only what its own bits declare.
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
   * Leads with `globalBitGl` (group 0) and `cameraBit` (group 1) unless the descriptor sets
   * `includeGlobal` or `includeCamera` to `false`, so `global` keeps its binding slots. Then come the
   * descriptor's bits, then the mesh's own, so callers only provide the bits unique to their pass:
   * the position decode for its `aPosition` format, the morph bit when it has a `morph`, and
   * skinning when it has a `skeleton`. That is the order the vertex `{{input}}` slot runs them in:
   * morph deltas apply to dequantized positions (`getPositionBit` says how), and skinning moves the
   * morphed pose. A pass supplies its own `instanceFetchBitGl`, since it declares the store and
   * index textures it reads, which not every template wants.
   *
   * The cache key is the descriptor's key plus the names of the bits added here, so variants with
   * and without them never share a shader. `assertBitIdentity` checks that each appended name
   * stands for one bit.
   *
   * When `validateMaterial` is true, the mesh's material is also checked against the texture
   * slots and struct its shader's bits declare. The batcher packs `material._textures` by position,
   * and the generated `sampleX` getters read slots in the order the bits declare their `textures`,
   * so a mismatch would sample the wrong texture. The check is about the material, so it runs on
   * cache hits too.
   *
   * Use this for custom render passes that need their own shader variant.
   * For the main material shader, use `ensureMaterial` instead.
   * @param descriptor - The shader descriptor containing bits, template, and overrides
   * @param mesh - The mesh to compile for, which picks the position, morph and skinning bits
   * @param plugins - Additional compiler plugins to run during compilation (e.g. batch textures)
   * @param validateMaterial - When true, validates the material against the shader's layout
   * @param glslOptions - GLSL-specific compilation options; defaults to no uniform blocks and no
   *   locations, which every caller uses
   * @returns The compiled (or cached) shader
   */
  public compileShader(
    descriptor: ShaderDescriptor,
    mesh: Mesh3DData,
    plugins?: ShaderCompilerPlugin[],
    validateMaterial = false,
    glslOptions: CompileGlslSourceOptions = { uboGroups: [], useLocations: false },
  ): Shader {
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

    const positionBit = getPositionBit(mesh.geometry.attributes.aPosition.format!);
    assertBitIdentity(positionBit);
    finalBits.push(positionBit);
    key += `|${positionBit.name}`;

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

    const cached = this._shaderCache.get(key);
    const layout = cached?.layout ?? getMaterialLayout(finalBits);

    if (validateMaterial) {
      validateMaterialTextureSlots(layout, mesh.material);
      validateMaterialStruct(layout, mesh.material);
    }

    if (cached) return cached.shader;

    const gl = compileGlslSource({
      bits: finalBits,
      template: descriptor.template!,
      extraPlugins: plugins,
      ...glslOptions,
      overrides: descriptor.overrides,
    });

    const shader = Shader.from({
      gl: gl as any,
      groups: undefined as any,
      overrides: descriptor.overrides,
      groupMap: gl.groupMap,
    });
    this._shaderCache.set(key, { shader, layout });

    return shader;
  }

  /**
   * Makes the mesh's material fully resident for this pipe
   *
   * Registers the material in the pipe's material store, so its data changes queue themselves from
   * then on; the store is looked up here because pixi builds pipes after systems. Then returns a
   * cached shader for its material + feature set, compiling one if it doesn't exist yet, and writes
   * shader, state and topology into `mesh._passCache` at the material's pass bit.
   *
   * Bits writing the same slot run in list order, so the order matters:
   *
   * 1. `globalBitGl`, the shared varyings and the instance fetch, then the geometry's normal and UV
   *    bits. `globalBitGl` leads here, so the descriptor stops `compileShader` adding it again; the
   *    camera bit still comes from there.
   * 2. The double-sided flip, then flat shading, so a normal map perturbs the face normal rather
   *    than being overwritten by it, then normal mapping. These come before the material's bits so
   *    that, say, `transmissionBit` refracts through the perturbed normal.
   * 3. The vertex-colour tint, when the geometry has colours and `material.vertexColors` is on.
   *    It comes before the material's bits so `pbrMaterialBit` mixes `fresnelF0` toward the tinted
   *    albedo, and metals pick up the tint.
   * 4. The billboard bit, before the material's bits and the fog bit: all three write the vertex
   *    `afterTransform` slot, and the other two read the `worldPosition` it rebuilds. Its lit
   *    variant also turns the normal, which unlit materials never read.
   * 5. The material's own bits from `getPrimaryDescriptor(view3d)`. Environment lighting is among
   *    them rather than added here, since it reads the PBR bits' variables, which not every lit
   *    material has. With a `TANGENT` attribute, the anisotropy bit is swapped for its
   *    vertex-tangent variant.
   * 6. The view's fog bit unless `material.fog` is off, then its tone-mapping bit unless
   *    `material.toneMapped` is off, so fog mixes in linear radiance before the tone curve. Only
   *    this pass tone-maps; shadow and depth passes compile through `compileShader`.
   * 7. For lit materials only, as unlit ones have no light loop to call it: the shadow sampler for
   *    the view's filter when the mesh receives shadows and the view has had a shadow-casting light
   *    (`view3d._hasShadows`), or else the no-op stub.
   * @param mesh - The mesh whose material is made resident
   * @param view3d - The view supplying tone-mapping/fog/shadow configuration
   * @returns The material's compiled shader
   */
  public ensureMaterial(mesh: Mesh3DData, view3d: View3D): Shader {
    const geo = mesh.geometry;
    const material = mesh.material;

    this._renderer.renderPipes.view3d.materialStoreBuffer.register(material);
    const passBit = material._passBit & RenderPassBit.MATERIAL_PASS_MASK;

    const pd = material._passes[passBit];
    const materialDescriptor = material.getPrimaryDescriptor(view3d);

    const bitsGl: ShaderBit[] = [globalBitGl, layoutBit, instanceFetchMaterialBitGl];

    if (geo.attributes.aNormal) bitsGl.push(normalBit);
    if (geo.attributes.aUV) bitsGl.push(getUvsBit(geo.attributes.aUV.format!));
    if (material.doubleSided) bitsGl.push(doubleSidedNormalBit);
    if (material.flatShading) bitsGl.push(flatShadingBit);

    const normalTexture = material.textures.normal;
    if (normalTexture && normalTexture !== NORMAL_MAP && geo.attributes.aUV) {
      bitsGl.push(geo.attributes.aTangent ? tangentNormalMappingBit : normalMappingBit);
    }

    if (geo.attributes.aColor && mesh.material.vertexColors) {
      bitsGl.push(vertexColorBit);
    }

    const lit = mesh.material.lit;

    if (mesh.billboardMode !== 'none') {
      bitsGl.push(getMeshBillboardBit(mesh.billboardMode, lit));
    }

    const hasTangent = !!geo.attributes.aTangent;
    for (let i = 0; i < materialDescriptor.bitsGl.length; i++) {
      const bit = materialDescriptor.bitsGl[i];
      bitsGl.push(hasTangent ? anisotropyTangentVariant(bit) : bit);
    }

    const fogBit = view3d._fogBit;
    if (fogBit && material.fog) bitsGl.push(fogBit);

    const toneBit = view3d._toneMappingBit;
    if (mesh.material.toneMapped && toneBit) bitsGl.push(toneBit);

    if (lit) {
      bitsGl.push(mesh.receiveShadow && view3d._hasShadows ? shadowBitsGl[view3d.shadowFilter] : noShadowBit);
    }

    const descriptor = scratchDescriptor.update({
      bitsGl,
      template: materialDescriptor.template ?? template,
      overrides: {
        HAS_UVS: geo.attributes.aUV ? 1 : 0,
        ...materialDescriptor.overrides,
      },
      includeGlobal: false,
    });

    const shader = this.compileShader(
      descriptor,
      mesh,
      [materialStructPackPlugin, materialTextureAccessPluginGl, texturesPluginGl],
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
   * Shaders compiled here belong to this system alone, so all of them are freed.
   */
  public destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    for (const { shader } of this._shaderCache.values()) shader.destroy();
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
