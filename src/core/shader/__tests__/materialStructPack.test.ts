import { WGSL_ALIGN_SIZE_DATA } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { MATERIAL_STRIDE_BYTES } from '~/core/buffers/MaterialDataStoreBuffer';
import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { materialAccessPluginGl } from '~/core/gl/shader/materialAccessPluginGl';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { materialStoragePaddingPlugin } from '~/core/gpu/codegen/materialStoragePaddingPlugin';
import { alphaMaskBit } from '~/core/shader/bits/alphaMaskBit';
import { emissiveBit } from '~/core/shader/bits/emissiveBit';
import { normalMappingBit } from '~/core/shader/bits/normalMappingBit';
import { uvTransformBit } from '~/core/shader/bits/uvTransformBit';
import { materialStructPackPlugin } from '~/core/shader/codegen/materialStructPackPlugin';
import { createStructLayout } from '~/core/shader/codegen/structLayout';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import type { ShaderCompilerContext } from '~/core/shader/ShaderCompilerPlugin';
import { clearcoatBit } from '~/materials/pbr/bits/clearcoatBit';
import { iridescenceBit } from '~/materials/pbr/bits/iridescenceBit';
import { pbrMaterialBit } from '~/materials/pbr/bits/pbrMaterialBit';
import { sheenBit } from '~/materials/pbr/bits/sheenBit';
import { specularBit } from '~/materials/pbr/bits/specularBit';
import { transmissionBit } from '~/materials/pbr/bits/transmissionBit';

// Worst-case bit order: scalar-contributing bits interleaved ahead of the
// vec4-heavy ones, the shape that produced #83's padding blow-up before
// materialStructPackPlugin made declaration order irrelevant.
const WORST_CASE_BITS = [
  alphaMaskBit,
  pbrMaterialBit,
  normalMappingBit,
  uvTransformBit,
  emissiveBit,
  specularBit,
  iridescenceBit,
  transmissionBit,
  clearcoatBit,
  sheenBit,
];

const wgslTemplate: ShaderBitTemplate = { bindGroups: [], gpu: '{{header}}' };
const glslTemplate: ShaderBitTemplate = {
  bindGroups: [],
  gl: { vertex: '{{header}}\nvoid main() {}', fragment: '{{header}}\nvoid main() {}' },
};

/** Extracts field names from the emitted `struct Material { ... }` WGSL block. */
function wgslMaterialStructFieldOrder(source: string): string[] {
  const match = source.match(/struct Material \{([^}]*)\}/);

  expect(match).not.toBeNull();

  return [...match![1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
}

describe('materialStructPackPlugin — cross-backend integration', () => {
  const gpu = compileWgslSource({
    bits: WORST_CASE_BITS,
    template: wgslTemplate,
    extraPlugins: [materialStructPackPlugin, materialStoragePaddingPlugin],
  });
  const gl = compileGlslSource({
    bits: WORST_CASE_BITS,
    template: glslTemplate,
    extraPlugins: [materialStructPackPlugin],
  });

  it('should produce identical Material field order on both backends', () => {
    const gpuKeys = Object.keys(gpu.structs.Material).filter((k) => k !== '_pad');
    const glKeys = Object.keys(gl.structs.Material);

    expect(gpuKeys.length).toBeGreaterThan(0);
    expect(glKeys).toEqual(gpuKeys);
  });

  it('should emit the WGSL Material struct in packed order with _pad last', () => {
    const emittedOrder = wgslMaterialStructFieldOrder(gpu.vertex.source);

    expect(emittedOrder).toEqual(Object.keys(gpu.structs.Material));
    expect(emittedOrder[emittedOrder.length - 1]).toBe('_pad');
  });

  it('should lay out the all-features Material hole-free, within the storage stride', () => {
    const fields = gl.structs.Material;
    const layout = createStructLayout(fields as Record<string, string>);
    const dataBytes = Object.values(fields).reduce((sum, type) => sum + WGSL_ALIGN_SIZE_DATA[type].size, 0);

    // This def has more scalars than vec3s, so the packed layout has zero
    // internal padding — total size is exactly the sum of the field sizes.
    expect(layout.size).toBe(dataBytes);
    expect(layout.size).toBeLessThanOrEqual(MATERIAL_STRIDE_BYTES);
  });
});

describe('materialStoragePaddingPlugin — overflow', () => {
  it('should throw with the computed layout when the Material struct exceeds the stride', () => {
    // 17 vec4s = 272 bytes > 256-byte stride.
    const fields: Record<string, string> = {};
    for (let i = 0; i < 17; i++) fields[`v${i}`] = 'vec4<f32>';

    const context = {
      bits: [],
      template: { bindGroups: [] },
      templateString: '',
      data: { structs: { Material: fields } },
    } as unknown as ShaderCompilerContext;

    expect(() => materialStoragePaddingPlugin.preCompile!(context)).toThrowError(/272 bytes[\s\S]*v16: vec4<f32>/);
  });
});

describe('empty Material struct', () => {
  const gpuStorageBit: ShaderBit = {
    name: 'emptyMaterialStorageGpuTest',
    bindings: { global: { uMaterialStorage: 'storage<Material>' } },
  };
  const glStorageBit: ShaderBit = {
    name: 'emptyMaterialStorageGlTest',
    bindings: { global: { uMaterialStorage: 'texture_2d<f32>' } },
  };
  const glMaterialBit: ShaderBit = {
    name: 'materialFieldTest',
    bindings: { material: { value: 'f32' } },
  };
  const storageWgslTemplate: ShaderBitTemplate = { bindGroups: ['global'], gpu: '{{header}}' };
  const storageGlslTemplate: ShaderBitTemplate = {
    bindGroups: ['global'],
    gl: {
      vertex: '{{header}}\nvoid main() { {{materialAccess}} gl_Position = vec4(0.0); }',
      fragment: '{{header}}\nout vec4 fragColor;\nvoid main() { {{materialAccess}} fragColor = vec4(1.0); }',
    },
  };

  it('pads an empty WebGPU Material struct to the storage stride', () => {
    const gpu = compileWgslSource({
      bits: [gpuStorageBit],
      template: storageWgslTemplate,
      extraPlugins: [materialStructPackPlugin, materialStoragePaddingPlugin],
    });

    expect(gpu.structs.Material).toEqual({ _pad: 'array<f32, 64>' });
    expect(gpu.vertex.source).toContain('struct Material {\n  _pad: array<f32, 64>,\n}');
    expect(gpu.vertex.source).toContain('var<storage, read> uMaterialStorage: array<Material>;');
  });

  it('allows WebGL to omit material access when the schema is empty', () => {
    const empty = compileGlslSource({
      bits: [glStorageBit],
      template: storageGlslTemplate,
      extraPlugins: [materialStructPackPlugin, materialAccessPluginGl],
      uboGroups: [],
      useLocations: false,
    });
    const populated = compileGlslSource({
      bits: [glStorageBit, glMaterialBit],
      template: storageGlslTemplate,
      extraPlugins: [materialStructPackPlugin, materialAccessPluginGl],
      uboGroups: [],
      useLocations: false,
    });

    expect(empty.vertex).not.toContain('struct Material');
    expect(empty.vertex).not.toContain('getMaterial');
    expect(empty.fragment).not.toContain('getMaterial');
    expect(populated.vertex).toContain('struct Material');
    expect(populated.vertex).toContain('Material material = getMaterial(vMaterialIndex);');
    expect(populated.fragment).toContain('Material material = getMaterial(vMaterialIndex);');
  });
});
