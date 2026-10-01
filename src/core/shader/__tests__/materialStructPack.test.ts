import { wgslCompilationErrors } from '@test-utils';
import { WGSL_ALIGN_SIZE_DATA } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { MATERIAL_STRIDE_BYTES } from '~/core/buffers/MaterialDataStoreBuffer';
import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { materialTextureAccessPluginGl } from '~/core/gl/codegen/materialTextureAccessPluginGl';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { materialTextureAccessPlugin } from '~/core/gpu/codegen/materialTextureAccessPlugin';
import { alphaMaskBit } from '~/core/shader/bits/alphaMaskBit';
import { emissiveBit } from '~/core/shader/bits/emissiveBit';
import { normalMappingBit } from '~/core/shader/bits/normalMappingBit';
import { uvTransformBit } from '~/core/shader/bits/uvTransformBit';
import { mergeMaterialStruct } from '~/core/shader/codegen/materialStruct';
import { materialStructPackPlugin } from '~/core/shader/codegen/materialStructPackPlugin';
import { createStructLayout } from '~/core/shader/codegen/structLayout';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { clearcoatBit } from '~/materials/pbr/bits/clearcoatBit';
import { iridescenceBit } from '~/materials/pbr/bits/iridescenceBit';
import { pbrMaterialBit } from '~/materials/pbr/bits/pbrMaterialBit';
import { sheenBit } from '~/materials/pbr/bits/sheenBit';
import { specularBit } from '~/materials/pbr/bits/specularBit';
import { transmissionBit } from '~/materials/pbr/bits/transmissionBit';

/** An all-features PBR material's bits, led by the scalar-only `alphaMaskBit` so a scalar precedes the vec4s */
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

/** The field names of the emitted WGSL `struct Material`, in order */
function wgslMaterialStructFieldOrder(source: string): string[] {
  const match = source.match(/struct Material \{([^}]*)\}/);

  expect(match).not.toBeNull();

  return [...match![1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
}

describe('materialStructPackPlugin on both backends', () => {
  const gpu = compileWgslSource({
    bits: WORST_CASE_BITS,
    template: wgslTemplate,
    extraPlugins: [materialStructPackPlugin, materialTextureAccessPlugin],
  });
  const gl = compileGlslSource({
    bits: WORST_CASE_BITS,
    template: glslTemplate,
    extraPlugins: [materialStructPackPlugin, materialTextureAccessPluginGl],
  });

  it('should produce identical Material field order on both backends', () => {
    const gpuKeys = Object.keys(gpu.structs.Material);
    const glKeys = Object.keys(gl.structs.Material);

    expect(gpuKeys.length).toBeGreaterThan(0);
    expect(glKeys).toEqual(gpuKeys);
  });

  it('should emit the WGSL Material struct in packed order', () => {
    const emittedOrder = wgslMaterialStructFieldOrder(gpu.vertex.source);

    expect(emittedOrder).toEqual(Object.keys(gpu.structs.Material));
  });

  it('should lay out the all-features Material with no padding, since it has more scalars than vec3s, within the stride', () => {
    const fields = gl.structs.Material;
    const layout = createStructLayout(fields as Record<string, string>);
    const dataBytes = Object.values(fields).reduce((sum, type) => sum + WGSL_ALIGN_SIZE_DATA[type].size, 0);

    expect(layout.size).toBe(dataBytes);
    expect(layout.size).toBeLessThanOrEqual(MATERIAL_STRIDE_BYTES);
  });
});

describe('material struct overflow', () => {
  it('throws with the computed layout when the Material struct passes the stride: 17 vec4s, 272 bytes, against 256', () => {
    const material: Record<string, string> = {};
    for (let i = 0; i < 17; i++) material[`v${i}`] = 'vec4<f32>';
    const bit = { name: 'overflowBit', bindings: { material } } as ShaderBit;

    expect(() => mergeMaterialStruct([bit])).toThrowError(/272 bytes[\s\S]*v16: vec4<f32>/);
  });
});

describe('empty Material struct', () => {
  const storageBit: ShaderBit = {
    name: 'emptyMaterialStorageTest',
    bindings: { global: { uMaterialStorage: 'texture_2d<u32>' } },
  };
  const glMaterialBit: ShaderBit = {
    name: 'materialFieldTest',
    bindings: { material: { value: 'f32' } },
  };
  const storageWgslTemplate: ShaderBitTemplate = {
    bindGroups: ['global'],
    gpu: '{{header}}\n{{textureGetters}}\nfn main() { let vMaterialIndex = 0u; {{vertexMaterialAccess}} }',
  };
  const storageGlslTemplate: ShaderBitTemplate = {
    bindGroups: ['global'],
    gl: {
      vertex: '{{header}}\n{{textureGetters}}\nvoid main() { {{materialAccess}} gl_Position = vec4(0.0); }',
      fragment:
        '{{header}}\n{{textureGetters}}\nout vec4 fragColor;\nvoid main() { {{materialAccess}} fragColor = vec4(1.0); }',
    },
  };

  it('allows WebGPU to omit material access when the schema is empty', () => {
    const empty = compileWgslSource({
      bits: [storageBit],
      template: storageWgslTemplate,
      extraPlugins: [materialStructPackPlugin, materialTextureAccessPlugin],
    });
    const populated = compileWgslSource({
      bits: [storageBit, glMaterialBit],
      template: storageWgslTemplate,
      extraPlugins: [materialStructPackPlugin, materialTextureAccessPlugin],
    });

    expect(empty.structs.Material).toBeUndefined();
    expect(empty.vertex.source).not.toContain('struct Material');
    expect(empty.vertex.source).not.toContain('getMaterial');
    expect(empty.vertex.source).toContain('var uMaterialStorage: texture_2d<u32>;');
    expect(populated.vertex.source).toContain('struct Material');
    expect(populated.vertex.source).toContain('fn getMaterial(index: u32) -> Material {');
    expect(populated.vertex.source).toContain('var material = getMaterial(vMaterialIndex);');
  });

  it('allows WebGL to omit material access when the schema is empty', () => {
    const empty = compileGlslSource({
      bits: [storageBit],
      template: storageGlslTemplate,
      extraPlugins: [materialStructPackPlugin, materialTextureAccessPluginGl],
      uboGroups: [],
      useLocations: false,
    });
    const populated = compileGlslSource({
      bits: [storageBit, glMaterialBit],
      template: storageGlslTemplate,
      extraPlugins: [materialStructPackPlugin, materialTextureAccessPluginGl],
      uboGroups: [],
      useLocations: false,
    });

    expect(empty.structs.Material).toBeUndefined();
    expect(empty.vertex).not.toContain('struct Material');
    expect(empty.vertex).not.toContain('getMaterial');
    expect(empty.fragment).not.toContain('getMaterial');
    expect(populated.vertex).toContain('struct Material');
    expect(populated.vertex).toContain('Material material = getMaterial(vMaterialIndex);');
    expect(populated.fragment).toContain('Material material = getMaterial(vMaterialIndex);');
  });
});

describe('integer material fields', () => {
  it('reads a u32 field straight from the texel on both backends', () => {
    const bit: ShaderBit = {
      name: 'intFieldTest',
      bindings: { global: { uMaterialStorage: 'texture_2d<u32>' }, material: { flags: 'u32' } },
    };
    const gpu = compileWgslSource({
      bits: [bit],
      template: { bindGroups: ['global'], gpu: '{{header}}\n{{textureGetters}}' },
      extraPlugins: [materialStructPackPlugin, materialTextureAccessPlugin],
    });
    const gl = compileGlslSource({
      bits: [bit],
      template: {
        bindGroups: ['global'],
        gl: {
          vertex: '{{header}}\n{{textureGetters}}\nvoid main() {}',
          fragment: '{{header}}\n{{textureGetters}}\nvoid main() {}',
        },
      },
      extraPlugins: [materialStructPackPlugin, materialTextureAccessPluginGl],
      uboGroups: [],
      useLocations: false,
    });

    expect(gpu.vertex.source).toContain('m.flags = t0.x;');
    expect(gl.vertex).toContain('m.flags = t0.x;');
  });
});

describe('material field types', () => {
  const materialBit = (name: string, material: Record<string, string>): ShaderBit =>
    ({ name, bindings: { material } }) as ShaderBit;

  it('rejects a field type the accessors cannot read, naming the bit and the field', () => {
    expect(() => mergeMaterialStruct([materialBit('arrayBit', { values: 'array<f32, 4>' })])).toThrowError(
      /"values" in bit "arrayBit" is "array<f32, 4>"/,
    );
    expect(() => mergeMaterialStruct([materialBit('matrixBit', { basis: 'mat3x3<f32>' })])).toThrowError(
      /"basis" in bit "matrixBit" is "mat3x3<f32>"/,
    );
    expect(() => mergeMaterialStruct([materialBit('halfBit', { tint: 'vec4<f16>' })])).toThrowError(
      /"tint" in bit "halfBit" is "vec4<f16>"/,
    );
    expect(() => mergeMaterialStruct([materialBit('intVectorBit', { ids: 'vec2<u32>' })])).toThrowError(
      /"ids" in bit "intVectorBit" is "vec2<u32>"/,
    );
  });

  it('skips an integer texture declared in the material group', () => {
    expect(mergeMaterialStruct([materialBit('integerTextureBit', { rows: 'texture_2d<u32>' })])).toEqual({});
  });

  it('reads a mat2x2 field as two columns on both backends, and WebGPU compiles it', async () => {
    const bit: ShaderBit = {
      name: 'mat2Test',
      bindings: { global: { uMaterialStorage: 'texture_2d<u32>' }, material: { tint: 'mat2x2<f32>', gain: 'f32' } },
    };
    const gpu = compileWgslSource({
      bits: [bit],
      template: {
        bindGroups: ['global'],
        gpu: `{{header}}
{{textureGetters}}

@fragment
fn mainFragment() -> @location(0) vec4<f32> {
  let vMaterialIndex = 0u;
  {{fragmentMaterialAccess}}
  return vec4<f32>(material.tint * vec2<f32>(material.gain), 0.0, 1.0);
}`,
      },
      extraPlugins: [materialStructPackPlugin, materialTextureAccessPlugin],
    });
    const gl = compileGlslSource({
      bits: [bit],
      template: {
        bindGroups: ['global'],
        gl: {
          vertex: '{{header}}\n{{textureGetters}}\nvoid main() {}',
          fragment: '{{header}}\n{{textureGetters}}\nvoid main() {}',
        },
      },
      extraPlugins: [materialStructPackPlugin, materialTextureAccessPluginGl],
      uboGroups: [],
      useLocations: false,
    });

    expect(gpu.fragment.source).toContain(
      'm.tint = mat2x2<f32>(bitcast<vec2<f32>>(t0.xy), bitcast<vec2<f32>>(t0.zw));',
    );
    expect(gpu.fragment.source).toContain('m.gain = bitcast<f32>(t1.x);');
    expect(gl.vertex).toContain('m.tint = mat2(uintBitsToFloat(t0.xy), uintBitsToFloat(t0.zw));');

    const adapter = await navigator.gpu.requestAdapter();
    expect(adapter).toBeTruthy();
    const device = await adapter!.requestDevice();

    try {
      expect(await wgslCompilationErrors(device, gpu.fragment.source)).toEqual([]);
    } finally {
      device.destroy();
    }
  });
});
