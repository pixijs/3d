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

const scratchDescriptor = new ShaderDescriptor({});

/** WebGL compiles materials only in the merged form, since a direct form's uniform block rebinds per draw */
const MATERIAL_PLUGINS: ShaderCompilerPlugin[] = [
  materialStructPackPlugin,
  materialTextureAccessPluginGl,
  createTexturesPluginGl(),
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
 * Mirrors the WGSL template in `MaterialSystemGpu`, premultiplying the output for pixi's `'normal'` blend. The
 * `inputExposure` it calls comes from the colour-space bit `_passShaderDescriptor` always adds.
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
   * Appends the mesh's position, morph and skinning bits in the order they deform the vertex, and every bit
   * added here joins the cache key. A shader whose bits read the material gets its layout bit. The bit's name
   * joins the key, so the material is checked only when the shader compiles
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
   * Writes the mesh's shader, state and topology for `pass` into its pass entry, in place, since
   * other code holds the entry
   */
  public ensurePassShader(mesh: Mesh3DData, batch: Mesh3DBatch, pass: RenderPass, view3d: View3D): void {
    const bit = pass.bit;
    const material = mesh.material;
    const materialEntry = material._passes[bit];
    const ownDescriptor =
      (materialEntry && materialEntry.shaderDescriptor) || (pass.descriptor && pass.descriptor.shaderDescriptor);
    const level = pass.level;
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
          "template. Give the pass a `level`, such as 'shape', to draw it with the material's own bits, or " +
          'give the shader a template of its own.',
      );
    }

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
   * Bits writing one slot run in list order: normal changes (flat shading, then the normal map), tint, billboard and
   * the geometry's bits before the material's bits, `alphaOpaqueBit` after them, fog before tone mapping, and the
   * pass's bits last. A pass's `level` then drops the bits above it, apart from the template's own. The pass's shader
   * bits and the entry's `extraBits` go after, and are never dropped.
   * @returns `scratchDescriptor`, which the next call overwrites
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

    const geometryBits = geo.extraBits;
    for (let i = 0; i < geometryBits.length; i++) bitsGl.push(geometryBits[i]);
    if (geo._vertexBit) bitsGl.push(geo._vertexBit);

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

    const level = pass.level;
    const filtered = level !== undefined && level !== 'color';
    /** A level that drops bits draws on the engine template, which the kept engine bits are written for */
    const ownTemplate = filtered ? undefined : materialDescriptor.template;
    const outputLocations = addPassMaterialBits(bitsGl, pass, !!ownTemplate);

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
      template: ownTemplate ?? template,
      overrides: {
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
