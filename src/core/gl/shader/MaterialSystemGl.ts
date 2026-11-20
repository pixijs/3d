import type { ShaderGroups } from 'pixi.js';
import { ExtensionType, Shader } from 'pixi.js';

import {
  getMaterialLayout,
  validateMaterialStruct,
  validateMaterialTextureSlots,
} from '../../../materials/utils/validateMaterialTextureSlots';
import type { View3D } from '../../../scene/View3D';
import type { Mesh3DBatch } from '../../batcher/Mesh3DBatch';
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
import { instanceFetchMaterialBitGl } from '../../shader/bits/instanceFetchBitGl';
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
import { createTexturesPluginGl } from './texturesPluginGl';

/** Reused by every `_passShaderDescriptor` call rather than allocating a descriptor each time */
const scratchDescriptor = new ShaderDescriptor({});

/**
 * The compiler plugins a material shader takes: it reads its struct from the material store's
 * texture at each instance's row, and its textures by binding. That is the merged form, the only
 * one WebGL compiles a material in.
 */
const MATERIAL_PLUGINS: ShaderCompilerPlugin[] = [
  materialStructPackPlugin,
  materialTextureAccessPluginGl,
  createTexturesPluginGl('merged'),
];

/**
 * Mirrors the WGSL template in `MaterialSystemGpu`, so bits see the same locals in the same slots. The world normal
 * divides by each column's squared length, exact for rotation and scale and cheaper than an inverse.
 */
const glVertexTemplate = `#version 300 es

{{header}}
{{textureGetters}}

void main() {
  mat4 modelMatrix;

  vec4 position;
  vec3 normal = vec3(0.0, 0.0, 1.0);
  vec3 tangent = vec3(0.0);
  vec2 uv = vec2(0.0);

  {{input}}

  {{storeAccess}}

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
 * `{{lighting}}`. The view's exposure, 1 unless the view sets it, scales the result before
 * `{{end}}`, where fog and tone mapping run. `inputExposure` picks the exposure for the shader's
 * colour space; it comes from the colour-space bit that `_passShaderDescriptor`, the template's only
 * user, always adds. Shading works in straight alpha, so `outputs.color` is premultiplied here for
 * pixi's default `'normal'` blend, `src + dst * (1 - srcAlpha)`, and a transparent material needs
 * no blend mode of its own.
 *
 * Bits write fragment outputs through the `outputs` local, which `{{declareOutputs}}` declares,
 * and `{{writeOutputs}}` copies the ones the descriptor gives a location to their `out` variables
 * (`glslFragmentOutputsPlugin`).
 */
const glFragmentTemplate = `#version 300 es

{{header}}

{{textureGetters}}

void main() {
  {{declareOutputs}}
  vec3 normal = normalize(vNormal);
  vec3 albedo = vec3(1.0);
  vec3 finalColor;
  float alpha = 1.0;

  {{storeAccess}}

  {{material}}

  finalColor = albedo;

  {{lighting}}

  finalColor *= inputExposure(uExposure, uDisplayExposure);

  {{end}}

  outputs.color = vec4(finalColor * alpha, alpha);

  {{writeOutputs}}
}`;

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
  gl: {
    vertex: glVertexTemplate,
    fragment: glFragmentTemplate,
  },
};

/** @internal */
export class MaterialSystemGl {
  /** @ignore */
  public static extension = {
    type: [ExtensionType.WebGLSystem],
    name: 'material3d',
  } as const;

  public batcher = new Mesh3DBatcherGl();

  private _destroyed = false;

  public _shaderCache = new Map<string, { shader: Shader; bindsMaterial: boolean }>();

  public computeBatchKey(item: Mesh3DData, bit: number): number {
    const cache = item._passCache[bit];

    return packGlBatchKey(cache.shader.uid, cache.state, cache.topology);
  }

  public compileViewShader(bits: ShaderBit[], template: ShaderBitTemplate): Shader {
    const gl = compileGlslSource({
      bits: [globalBitGl, cameraBit, ...bits],
      template,
      useLocations: false,
    });
    assertBindGroups(gl.bits, template);
    return Shader.from({ gl, groups: {}, groupMap: gl.groupMap });
  }

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
   * the position bit for its `aPosition` format, the morph bit when it has a `_morph`, and
   * skinning when it has a `skeleton`. That is the order the vertex `{{input}}` slot runs them in:
   * morph deltas add to the position `getPositionBit` reads, and skinning moves the morphed
   * pose. A pass supplies its own `instanceFetchBitGl`, since it declares the store and
   * index textures it reads, which not every template wants.
   *
   * The cache key is the descriptor's key plus the names of the bits added here, so variants with
   * and without them never share a shader. `assertBitIdentity` checks that each appended name
   * stands for one bit.
   * The compiler adds the bits a listed bit `requires`. They stay out of the key, since the
   * listed bits already imply them.
   *
   * When a bit declares `bindings.instance`, the shader is compiled against the instance-data
   * layout of the batch that owns the mesh: the layout joins the key and goes to the compile,
   * where `instanceAccessPluginGl` adds the access code. A shader whose bits declare none is untouched.
   *
   * When a bit declares material fields or textures, the shader reads the material. It then gets
   * the material's layout bit ahead of the first such bit, so it declares the material's whole
   * group whichever of the material's bits it lists, and it compiles with the material plugins.
   * The layout bit's name joins the key. The material's texture slots and struct are checked
   * against what the shader declares when it compiles, and a shader that fails is not kept. A
   * material that finds the shader compiled has the layout it was checked with, since the layout
   * bit's name is in the key. A shader whose bits declare neither compiles without any of it.
   *
   * Use this for custom render passes that need their own shader variant.
   * The scene update goes through `ensurePassShader`, which picks a mesh's descriptor for a pass
   * and writes the mesh's pass cache.
   * @param descriptor - The shader descriptor containing bits, template, and overrides
   * @param mesh - The mesh to compile for, which picks the position, morph and skinning bits
   * @param batch - The batch the mesh is drawn in; a shader whose bits read instance data is compiled against its layout
   * @param glslOptions - GLSL-specific compilation options; defaults to no locations, which every
   *   caller uses
   * @returns The compiled (or cached) shader, and whether a draw with it binds the material
   */
  public compileShader(
    descriptor: ShaderDescriptor,
    mesh: Mesh3DData,
    batch: Mesh3DBatch,
    glslOptions: CompileGlslSourceOptions = { useLocations: false },
  ): { shader: Shader; bindsMaterial: boolean } {
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

    const bits = descriptor.bitsGl;
    const materialLayoutBit = mesh.material._materialLayoutBit;
    const readingBit = firstBitReadingMaterial(bits);
    const readsMaterial = readingBit >= 0;
    for (let i = 0; i < bits.length; i++) {
      if (i === readingBit) finalBits.push(materialLayoutBit);
      finalBits.push(bits[i]);
    }
    key += descriptor.keyGl;

    const positionBit = getPositionBit(mesh.geometry.attributes.aPosition.format!);
    assertBitIdentity(positionBit);
    finalBits.push(positionBit);
    key += `|${positionBit.name}`;

    if (mesh._morph) {
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

    if (batch.instanceStoreBuffer && readsInstanceData(finalBits)) {
      key += `|inst:${batch.instanceStoreBuffer.layout.key}`;
    }

    if (readsMaterial) key += `|${materialLayoutBit.name}`;

    let entry = this._shaderCache.get(key);

    if (!entry) {
      const gl = compileGlslSource({
        bits: finalBits,
        template: descriptor.template!,
        extraPlugins: readsMaterial ? MATERIAL_PLUGINS : undefined,
        instanceLayout: batch.instanceStoreBuffer?.layout,
        ...glslOptions,
        overrides: descriptor.overrides,
        outputLocations: descriptor.outputLocations,
      });

      assertBindGroups(gl.bits, descriptor.template!);

      if (readsMaterial) {
        const layout = getMaterialLayout(gl.bits);
        validateMaterialTextureSlots(layout, mesh.material);
        validateMaterialStruct(layout, mesh.material);
      }

      const shader = Shader.from({
        gl,
        groups: {},
        overrides: descriptor.overrides,
        groupMap: gl.groupMap,
      });
      entry = { shader, bindsMaterial: readsMaterial };
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
   * Otherwise the material's main pass draws with the material's shader. On WebGL that is always
   * the merged form: its textures bound once for the run, each instance reading its material row
   * from the store's texture. A direct form would bind the material's row as a uniform block,
   * which WebGL pays for on every draw.
   *
   * In any other pass the mesh has no shader, and its entry is left as it is.
   * @param mesh - The mesh to resolve the shader of
   * @param batch - The batch the mesh is drawn in
   * @param pass - The pass the mesh is drawn in
   * @param view3d - The view supplying tone-mapping/fog/shadow configuration
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
        `[MaterialSystemGl] The '${pass.name}' pass draws ${material.constructor.name} with a shader that has no ` +
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
   * Fills `scratchDescriptor` with the bit list of the mesh's main-pass shader, which
   * `ensurePassShader` compiles
   *
   * Bits writing the same slot run in list order, so the order matters:
   *
   * 1. `globalBitGl`, the shared varyings, the instance fetch and the colour-space bit, whose
   *    helpers the material's bits and the template read, then the geometry's normal and UV bits.
   *    `globalBitGl` leads here, so the descriptor stops `compileShader` adding it again; the
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
   * 6. `alphaOpaqueBit` when the material's `alphaMode` is `'opaque'`. It writes `end`, so it
   *    resets any alpha the material's bits wrote in any slot, a raw `descriptor`'s included. Fog
   *    and tone mapping, which follow it in that slot, don't read alpha.
   * 7. The view's fog bit unless `material.fog` is off, then its tone-mapping bit, so fog mixes in
   *    linear radiance before the tone curve. Every material takes it; it's `null` where the view
   *    writes linear light. A material that sets `_skipsToneCurve`, whose colour the view has
   *    curved already, takes `srgbEncodeBit` instead. When `selectColorSpaceBit` puts the shader in
   *    display space (step 1), no encode goes in, and the template scales by `uDisplayExposure`.
   *    The shader then draws the same bytes with no decode or encode.
   * 8. For lit materials only, as unlit ones have no light loop to call it: the shadow sampler for
   *    the view's filter when the mesh receives shadows and the view has had a shadow-casting light
   *    (`view3d._hasShadows`), or else the no-op stub. Then `decodeToLinearBit`, which transmission
   *    calls to read the opaque copy back as linear light: the 2.2 decode while the view's tone bit
   *    is set, a pass-through while it isn't.
   * 9. The pass's `materialBits` (`addPassMaterialBits`), the bit each attached output names for
   *    this pass. They go last so their vertex code reads the final `gl_Position`. The shader then
   *    takes the pass's `outputLocations`, so each output lands on the attachment the pass's target
   *    has for it. A material with a template of its own compiles without them, and its draws leave
   *    those textures alone.
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
    const geo = mesh.geometry;
    const material = mesh.material;
    const fogBit = material.fog ? view3d._fogBit : null;
    const toneBit = view3d._toneMappingBit;
    const vertexColored = !!geo.attributes.aColor && material.vertexColors;
    const colorSpaceBit = selectColorSpaceBit(material, toneBit, !!fogBit || vertexColored);
    const materialDescriptor = material.getPrimaryDescriptor(view3d);

    const bitsGl: ShaderBit[] = [globalBitGl, layoutBit, instanceFetchMaterialBitGl, colorSpaceBit];
    const templateBitCount = bitsGl.length;

    if (geo.attributes.aNormal) bitsGl.push(normalBit);
    if (geo.attributes.aUV) bitsGl.push(getUvsBit(geo.attributes.aUV.format!));
    if (material.doubleSided) bitsGl.push(doubleSidedNormalBit);
    if (material.flatShading) bitsGl.push(flatShadingBit);

    const normalTexture = material.textures.normal;
    if (normalTexture && normalTexture !== NORMAL_MAP && geo.attributes.aUV) {
      bitsGl.push(geo.attributes.aTangent ? tangentNormalMappingBit : normalMappingBit);
    }

    if (vertexColored) {
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

    if (material.alphaMode === 'opaque') bitsGl.push(alphaOpaqueBit);

    if (fogBit) bitsGl.push(fogBit);

    if (colorSpaceBit !== displayColorSpaceBit && toneBit) {
      bitsGl.push(material._skipsToneCurve ? srgbEncodeBit : toneBit);
    }

    if (lit) {
      bitsGl.push(
        mesh.receiveShadow && view3d._hasShadows ? shadowBitsGl[view3d.shadowFilter] : noShadowBit,
        decodeToLinearBit(toneBit !== null),
      );
    }

    const outputLocations = addPassMaterialBits(bitsGl, pass, !!materialDescriptor.template);

    const level = pass.level;
    const filtered = level !== undefined && level !== 'color';
    const materialOverrides = materialDescriptor.overrides;
    if (filtered) {
      let kept = templateBitCount;
      for (let i = templateBitCount; i < bitsGl.length; i++) {
        if (isBitInLevel(bitsGl[i], level)) bitsGl[kept++] = bitsGl[i];
      }
      bitsGl.length = kept;
    }

    if (ownDescriptor) {
      for (let i = 0; i < ownDescriptor.bitsGl.length; i++) bitsGl.push(ownDescriptor.bitsGl[i]);
    }

    const extraBits = material._passes[pass.bit]?.extraBits;
    if (extraBits) {
      for (let i = 0; i < extraBits.length; i++) bitsGl.push(extraBits[i]);
    }

    return scratchDescriptor.update({
      bitsGl,
      template: materialDescriptor.template ?? template,
      overrides: {
        HAS_UVS: geo.attributes.aUV ? 1 : 0,
        ...(filtered && materialOverrides ? declaredOverrides(materialOverrides, bitsGl) : materialOverrides),
        ...ownDescriptor?.overrides,
      },
      outputLocations,
      includeGlobal: false,
    });
  }

  public destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    for (const { shader } of this._shaderCache.values()) shader.destroy();
    (this._shaderCache as Map<string, { shader: Shader; bindsMaterial: boolean }> | null) = null;
  }
}

declare global {
  namespace PixiMixins {
    interface WebGLSystems {
      /** The WebGL 3D material shader cache and the shared mesh batcher */
      material3d: MaterialSystemGl;
    }
  }
}
