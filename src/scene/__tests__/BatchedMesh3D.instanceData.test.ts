import { captureWarnings, getApp, renderFrame, wgslCompilationErrors } from '@test-utils';
import { ShaderStage } from 'pixi.js';
import type { Renderer, Shader, WebGLRenderer, WebGPURenderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { createInstanceDataLayout } from '~/core/batcher/instanceDataLayout';
import { EMPTY_BUFFER_RESOURCE } from '~/core/buffers/emptyBufferResource';
import type { InstanceDataStoreBuffer } from '~/core/buffers/InstanceDataStoreBuffer';
import { GPU_VISIBILITY_MIN } from '~/core/gpu/cull';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { instanceFetchBitGl } from '~/core/shader/bits/instanceFetchBitGl';
import { resolveInstanceAccess } from '~/core/shader/codegen/instanceAccess';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { ShaderDescriptor } from '~/core/shader/ShaderDescriptor';
import { UINT_EMPTY } from '~/core/textures/DefaultTextures';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

type DirtyRange = { _dirty: { min: number; max: number; isEmpty: boolean }; update(): void };

type StoreViews = {
  _buffer: { _gpuData: Record<string, unknown>; update(): void } | null;
  _textureSource: { _gpuData: Record<string, unknown>; update(): void } | null;
};

const WIDTH = 96;
const HEIGHT = 32;

const tintBit: ShaderBit = {
  name: 'testInstanceTint',
  bindings: { instance: { tint: 'vec4<f32>', shape: 'vec4<f32>' } },
  gpu: {
    vertex: { beforeTransform: 'position = vec4<f32>(position.xyz * instance.shape.x, 1.0);' },
    fragment: { material: 'albedo = instance.tint.rgb;' },
  },
  gl: {
    vertex: { beforeTransform: 'position = vec4(position.xyz * instance.shape.x, 1.0);' },
    fragment: { material: 'albedo = instance.tint.rgb;' },
  },
};

const integerBit: ShaderBit = {
  name: 'testInstanceIntegers',
  bindings: { instance: { packed: 'vec4<u32>', nudge: 'vec4<i32>' } },
  gpu: {
    vertex: { beforeTransform: 'position.y = position.y + f32(instance.nudge.y);' },
    fragment: { material: 'albedo = vec3<f32>(instance.packed.rgb);' },
  },
  gl: {
    vertex: { beforeTransform: 'position.y = position.y + float(instance.nudge.y);' },
    fragment: { material: 'albedo = vec3(instance.packed.rgb);' },
  },
};

const FAR_SLOT = 3000;

const TINT_DATA = {
  tint: { value: [1, 1, 1, 1], type: 'vec4<f32>' },
  shape: { value: [1, 0, 0, 0], type: 'vec4<f32>' },
} as const;

function cubeRow(batched: BatchedMesh3D, material: FlatMaterial): CubeGeometry {
  const cube = new CubeGeometry({ width: 1, height: 1, depth: 1 });
  const m = new Matrix4();
  for (let i = 0; i < batched.size; i++) {
    m.makeTranslation((i - (batched.size - 1) / 2) * 2, 0, 0);
    batched.setGeometryAt(i, cube);
    batched.setMaterialAt(i, material);
    batched.setMatrixAt(i, m);
    batched.setPassesAt(i, RenderPassBit.OPAQUE);
  }

  return cube;
}

function createView(): View3D {
  const view3d = new View3D({ toneMapping: 'none', width: WIDTH, height: HEIGHT });
  view3d.camera.position.set(0, 0, 8);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

  return view3d;
}

function coloursIn(pixels: Uint8ClampedArray): Set<string> {
  const colours = new Set<string>();
  for (let p = 0; p < pixels.length; p += 4) {
    const r = pixels[p];
    const g = pixels[p + 1];
    const b = pixels[p + 2];
    if ((r > 40 && r < 215) || (g > 40 && g < 215) || (b > 40 && b < 215)) continue;
    colours.add(`${r > 127 ? 1 : 0}${g > 127 ? 1 : 0}${b > 127 ? 1 : 0}`);
  }
  colours.delete('000');

  return colours;
}

function coloursAcross(pixels: Uint8ClampedArray): string[] {
  const row = pixels.subarray((HEIGHT >> 1) * WIDTH * 4, ((HEIGHT >> 1) + 1) * WIDTH * 4);
  const runs: string[] = [];
  let last = '000';
  for (let p = 0; p < row.length; p += 4) {
    const r = row[p];
    const g = row[p + 1];
    const b = row[p + 2];
    if ((r > 40 && r < 215) || (g > 40 && g < 215) || (b > 40 && b < 215)) continue;
    const colour = `${r > 127 ? 1 : 0}${g > 127 ? 1 : 0}${b > 127 ? 1 : 0}`;
    if (colour !== last && colour !== '000') runs.push(colour);
    last = colour;
  }

  return runs;
}

const INSTANCE_BINDING = {
  webgpu: { name: 'uInstanceStorage', meshStore: 'uRenderableStorage' },
  webgl: { name: 'uInstanceStoreTexture', meshStore: 'uMeshStoreTexture' },
} as const;

function globalBindings(shader: Shader): Record<number, string | undefined> {
  if (!shader.gpuProgram) return { ...shader._uniformBindMap[0] };

  return Object.fromEntries(Object.entries(shader.gpuProgram.layout[0]).map(([name, index]) => [index, name]));
}

function fragmentCode(shader: Shader): string {
  if (!shader.gpuProgram) return shader.glProgram.fragment ?? '';

  const source = shader.gpuProgram.fragment!.source;

  return source.slice(source.indexOf('fn mainFragment'));
}

function destroyQuietly(batched: BatchedMesh3D): void {
  captureWarnings(() => batched.destroy());
}

function gpuCopies(store: InstanceDataStoreBuffer): number {
  const { _buffer, _textureSource } = store as unknown as StoreViews;

  return Object.keys(_buffer?._gpuData ?? {}).length + Object.keys(_textureSource?._gpuData ?? {}).length;
}

const shaderOf = (batched: BatchedMesh3D): Shader => batched.batch.items[0]._passCache[RenderPassBit.OPAQUE].shader;

function sourceOf(shader: Shader): string {
  return shader.gpuProgram
    ? `${shader.gpuProgram.vertex!.source}\n${shader.gpuProgram.fragment!.source}`
    : `${shader.glProgram.vertex ?? ''}\n${shader.glProgram.fragment ?? ''}`;
}

const customPassBit: ShaderBit = {
  name: 'testInstanceCustomPass',
  bindings: { instance: { tint: 'vec4<f32>' } },
  gpu: { fragment: { material: 'colour = instance.tint;' } },
  gl: { fragment: { material: 'colour = instance.tint;' } },
};

function customTemplate(slots: boolean): ShaderBitTemplate {
  return {
    bindGroups: [{ name: 'global', ubo: true }, 'camera'],
    gpu: /* wgsl */ `
{{header}}
{{vertexHeader}}

@vertex
fn mainVertex(
  input: VertexInput,
  @builtin(instance_index) ii: u32,
  @builtin(vertex_index) vid: u32
) -> VertexOutput {
  var output: VertexOutput;
  var position: vec4<f32>;
  var normal = vec3<f32>(0.0);
  var tangent = vec3<f32>(0.0);

  let inst = uRenderableInstanceStorage[ii];
  let renderable = uRenderableStorage[inst.id];
  ${slots ? '{{vertexStoreAccess}}' : ''}

  {{vertexInput}}

  output.position = camera.uViewProjectionMatrix * (uRenderableStorage[0].transform * renderable.transform * position);

  {{vertexEnd}}

  return output;
}

@fragment
fn mainFragment(input: FragmentInput) -> @location(0) vec4<f32> {
  var colour = vec4<f32>(0.0, 0.0, 0.0, 1.0);
  ${slots ? '{{fragmentStoreAccess}}' : ''}
  {{fragmentMaterial}}
  return colour;
}
`,
    gl: {
      vertex: /* glsl */ `#version 300 es

{{header}}

void main() {
  mat4 modelMatrix;
  vec4 position;
  vec3 normal = vec3(0.0);
  vec3 tangent = vec3(0.0);

  {{input}}
  ${slots ? '{{storeAccess}}' : ''}

  gl_Position = uViewProjectionMatrix * (modelMatrix * position);

  {{end}}
}`,
      fragment: /* glsl */ `#version 300 es
out vec4 fragColor;

{{header}}

void main() {
  vec4 colour = vec4(0.0, 0.0, 0.0, 1.0);
  ${slots ? '{{storeAccess}}' : ''}
  {{material}}
  fragColor = colour;
}`,
    },
  };
}

function glslCompileLog(gl: WebGL2RenderingContext, type: number, source: string): string {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  const log = gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? '' : (gl.getShaderInfoLog(shader) ?? 'failed');
  gl.deleteShader(shader);

  return log;
}

describe('instance data layout', () => {
  it('places each field in a row of its own store, in whole vec4s', () => {
    const layout = createInstanceDataLayout({
      look: { value: [1, 0.5, 0.25, 0], type: 'vec4<f32>' },
      ids: { value: [7, 8, 9, 10], type: 'vec4<u32>' },
      nudge: { value: [-1, 2, -3, 4], type: 'vec4<i32>' },
    });

    expect(layout.offsets).toEqual({ look: 0, ids: 4, nudge: 8 });
    expect(layout.stride).toBe(12);
    expect(layout.key).toBe('look:vec4<f32>,ids:vec4<u32>,nudge:vec4<i32>');
    expect([...new Float32Array(layout.defaults.buffer, 0, 4)]).toEqual([1, 0.5, 0.25, 0]);
    expect([...layout.defaults.subarray(4, 8)]).toEqual([7, 8, 9, 10]);
    expect([...new Int32Array(layout.defaults.buffer, 32, 4)]).toEqual([-1, 2, -3, 4]);
  });

  it('rejects a field it cannot lay out, naming it', () => {
    expect(() => createInstanceDataLayout({ 'a-b': { value: [0, 0, 0, 0], type: 'vec4<f32>' } })).toThrow(/"a-b"/);
    expect(() => createInstanceDataLayout({ a__b: { value: [0, 0, 0, 0], type: 'vec4<f32>' } })).toThrow(/"a__b"/);
    expect(() => createInstanceDataLayout({ '1a': { value: [0, 0, 0, 0], type: 'vec4<f32>' } })).toThrow(/"1a"/);
    expect(() => createInstanceDataLayout({ a: { value: [0, 0, 0], type: 'vec4<f32>' } })).toThrow(/four numbers/);
    expect(() => createInstanceDataLayout({ a: { value: [0, 0, 0, 0], type: 'f32' as 'vec4<f32>' } })).toThrow(
      /"a" is "f32"/,
    );
  });
});

describe('instance access', () => {
  const slotsTemplate: ShaderBitTemplate = {
    bindGroups: [],
    gpu: '{{vertexStoreAccess}} {{fragmentStoreAccess}}',
    gl: { vertex: '{{storeAccess}}', fragment: '{{storeAccess}}' },
  };

  it('loads what either stage names, and hands the fragment stage only what it names', () => {
    const batched = new BatchedMesh3D({
      size: 1,
      instanceData: { ...TINT_DATA, unread: { value: [0, 0, 0, 0], type: 'vec4<f32>' } },
    });
    const { layout } = batched.batch.instanceStoreBuffer!;

    for (const platform of ['gl', 'gpu'] as const) {
      const access = resolveInstanceAccess([tintBit], platform, layout, slotsTemplate);

      expect([...access.loaded].sort()).toEqual(['shape', 'tint']);
      expect(access.varyings).toEqual(['tint']);
    }

    batched.destroy();
  });

  it('hands the fragment stage no field for the word instance in a comment', () => {
    const layout = createInstanceDataLayout(TINT_DATA);
    const code = '// tint per instance\nalbedo = instance.tint.rgb; /* one instance */';
    const commented: ShaderBit = {
      ...tintBit,
      gpu: { fragment: { material: code } },
      gl: { fragment: { material: code } },
    };

    for (const platform of ['gl', 'gpu'] as const) {
      expect(resolveInstanceAccess([commented], platform, layout, slotsTemplate).varyings).toEqual(['tint']);
    }
  });
});

describe('BatchedMesh3D instance data (CPU)', () => {
  it('writes one field of one slot and queues that row of the instance store alone', () => {
    const batched = new BatchedMesh3D({
      size: 4,
      instanceData: { ...TINT_DATA, nudge: { value: [0, 0, 0, 0], type: 'vec4<i32>' } },
    });
    const instanceStore = batched.batch.instanceStoreBuffer as unknown as DirtyRange;
    const meshStore = batched.batch.storeBuffer as unknown as DirtyRange;
    const { data, u32Data, stride, offset, fields } = batched.instanceData;
    instanceStore.update();
    meshStore.update();

    batched.setInstanceDataAt(2, 'tint', 0.5, 0.25, 0.125, 1);
    batched.setInstanceDataAt(2, 'nudge', -1, 2, -3, 4);

    const row = offset + 2 * stride;
    expect([...data.subarray(row + fields.tint, row + fields.tint + 4)]).toEqual([0.5, 0.25, 0.125, 1]);
    expect([...new Int32Array(u32Data.buffer, (row + fields.nudge) * 4, 4)]).toEqual([-1, 2, -3, 4]);
    expect(data[offset + stride + fields.tint]).toBe(1);
    expect(data[offset + 3 * stride + fields.tint]).toBe(1);
    expect([instanceStore._dirty.min, instanceStore._dirty.max]).toEqual([3, 3]);
    expect(meshStore._dirty.isEmpty, 'an instance write leaves the mesh store clean').toBe(true);

    batched.destroy();
  });

  it('throws on a field the batch does not declare, naming it and the ones it has', () => {
    const batched = new BatchedMesh3D({ size: 1, instanceData: TINT_DATA });
    const plain = new BatchedMesh3D({ size: 1 });

    expect(() => batched.setInstanceDataAt(0, 'glow', 0, 0, 0, 0)).toThrow(/"glow".*tint, shape/);
    expect(() => plain.setInstanceDataAt(0, 'tint', 0, 0, 0, 0)).toThrow(/"tint".*declares none/);
    expect(() => plain.instanceData).toThrow(/has no instance data/);

    batched.destroy();
    plain.destroy();
  });

  it('allocates no instance store for a batch that declares none, nor for the scene batch', () => {
    const plain = new BatchedMesh3D({ size: 4 });
    const view3d = new View3D({ toneMapping: 'none', width: 8, height: 8 });

    expect(plain.batch.instanceStoreBuffer).toBe(null);
    expect(view3d._sceneBatch.instanceStoreBuffer).toBe(null);
    expect(() => new BatchedMesh3D({ size: 4, instanceData: {} })).toThrow(/no fields declared/);

    plain.destroy();
    view3d.destroy();
  });

  it('queues only the range a bulk update names, and rejects one outside the batch', () => {
    const batched = new BatchedMesh3D({ size: 8, instanceData: TINT_DATA });
    const instanceStore = batched.batch.instanceStoreBuffer as unknown as DirtyRange;
    const meshStore = batched.batch.storeBuffer as unknown as DirtyRange;
    instanceStore.update();
    meshStore.update();

    batched.instanceData.update(2, 3);
    expect([instanceStore._dirty.min, instanceStore._dirty.max]).toEqual([3, 5]);
    expect(meshStore._dirty.isEmpty).toBe(true);
    expect(() => batched.instanceData.update(6, 3)).toThrow(RangeError);

    instanceStore.update();
    batched.instanceData.update();
    expect([instanceStore._dirty.min, instanceStore._dirty.max]).toEqual([1, 8]);

    batched.destroy();
  });

  it('destroys the instance store with the batch and drops every reference to it', () => {
    const batched = new BatchedMesh3D({ size: 2, instanceData: TINT_DATA });
    const store = batched.batch.instanceStoreBuffer!;
    const view = batched.instanceData;

    batched.destroy();
    batched.destroy();

    expect(store.data, 'the store let go of its arrays').toBe(null);
    expect(batched.batch.instanceStoreBuffer).toBe(null);
    expect((view as unknown as { _store: unknown })._store).toBe(null);
    expect((batched.batch as unknown as { _instanceData: unknown })._instanceData).toBe(null);
  });
});

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`BatchedMesh3D instance data (${preference})`, () => {
    const appOptions = { preference, width: WIDTH, height: HEIGHT, resolution: 1, backgroundColor: 0x000000 };

    it('reads float fields in both stages, per slot, and follows later writes', async () => {
      const app = await getApp<Renderer>({ id: `batched-instance-${preference}`, appOptions });

      try {
        const view3d = createView();
        const material = new FlatMaterial({ extraBits: [tintBit] });
        const batched = new BatchedMesh3D({ size: 4, instanceData: TINT_DATA });
        cubeRow(batched, material);
        batched.setInstanceDataAt(0, 'tint', 1, 0, 0, 1);
        batched.setInstanceDataAt(1, 'tint', 0, 1, 0, 1);
        batched.setInstanceDataAt(2, 'tint', 0, 0, 1, 1);
        view3d.root.addChild(batched);
        app.stage.addChild(view3d);

        await renderFrame(app);
        expect(coloursAcross(await renderFrame(app)), 'slot 3 keeps the declared default, white').toEqual([
          '100',
          '010',
          '001',
          '111',
        ]);

        batched.setInstanceDataAt(1, 'shape', 0, 0, 0, 0);
        const { data, stride, offset, fields } = batched.instanceData;
        data.set([1, 1, 0, 1], offset + 3 * stride + fields.tint);
        batched.instanceData.update(3, 1);
        expect(
          coloursAcross(await renderFrame(app)),
          'the vertex stage reads `shape`, so a zero scale collapses slot 1, and slot 3 takes the bulk write',
        ).toEqual(['100', '001', '110']);

        view3d.destroy({ children: true });
      } finally {
        app.destroy();
      }
    });

    it('reads integer fields with their exact bits', async () => {
      const app = await getApp<Renderer>({ id: `batched-instance-int-${preference}`, appOptions });

      try {
        const view3d = createView();
        const material = new FlatMaterial({ extraBits: [integerBit] });
        const batched = new BatchedMesh3D({
          size: 2,
          instanceData: {
            packed: { value: [1, 0, 1, 0], type: 'vec4<u32>' },
            nudge: { value: [0, 0, 0, 0], type: 'vec4<i32>' },
          },
        });
        cubeRow(batched, material);
        batched.setInstanceDataAt(1, 'packed', 0, 1, 1, 0);
        view3d.root.addChild(batched);
        app.stage.addChild(view3d);

        await renderFrame(app);
        expect(coloursAcross(await renderFrame(app))).toEqual(['101', '011']);

        batched.setInstanceDataAt(1, 'nudge', 0, -100, 0, 0);
        expect(coloursIn(await renderFrame(app)), 'a large negative offset takes slot 1 out of view').toEqual(
          new Set(['101']),
        );

        batched.setInstanceDataAt(1, 'nudge', 0, -1, 0, 0);
        expect(coloursIn(await renderFrame(app)), 'a small negative offset keeps it in view, one unit down').toEqual(
          new Set(['101', '011']),
        );

        view3d.destroy({ children: true });
      } finally {
        app.destroy();
      }
    });

    it('reads a slot whose row lies past the first row of the WebGL data texture', async () => {
      const app = await getApp<Renderer>({ id: `batched-instance-far-${preference}`, appOptions });

      try {
        const view3d = createView();
        const material = new FlatMaterial({ extraBits: [tintBit] });
        const batched = new BatchedMesh3D({ size: FAR_SLOT + 1, instanceData: TINT_DATA });
        const cube = new CubeGeometry({ width: 1, height: 1, depth: 1 });
        const matrix = new Matrix4();
        for (let slot = 0; slot <= FAR_SLOT; slot++) {
          batched.setGeometryAt(slot, cube);
          batched.setMaterialAt(slot, material);
        }
        [0, FAR_SLOT].forEach((slot, i) => {
          batched.setMatrixAt(slot, matrix.makeTranslation(i * 2 - 1, 0, 0));
          batched.setPassesAt(slot, RenderPassBit.OPAQUE);
        });
        batched.setInstanceDataAt(0, 'tint', 1, 0, 0, 1);
        batched.setInstanceDataAt(FAR_SLOT, 'tint', 0, 1, 0, 1);
        view3d.root.addChild(batched);
        app.stage.addChild(view3d);

        await renderFrame(app);
        expect(coloursAcross(await renderFrame(app))).toEqual(['100', '010']);

        batched.setInstanceDataAt(FAR_SLOT, 'tint', 0, 0, 1, 1);
        expect(coloursAcross(await renderFrame(app)), 'a later write to the far row uploads').toEqual(['100', '001']);

        view3d.destroy({ children: true });
      } finally {
        app.destroy();
      }
    });

    it('reads each slot its own row after hidden slots are compacted out of the draw', async () => {
      const app = await getApp<Renderer>({ id: `batched-instance-compact-${preference}`, appOptions });

      try {
        const view3d = createView();
        const material = new FlatMaterial({ extraBits: [tintBit] });
        const last = GPU_VISIBILITY_MIN;
        const batched = new BatchedMesh3D({ size: last + 1, instanceData: TINT_DATA });
        const cube = new CubeGeometry({ width: 1, height: 1, depth: 1 });
        const matrix = new Matrix4().makeTranslation(0, 100, 0);
        for (let slot = 0; slot <= last; slot++) {
          batched.setGeometryAt(slot, cube);
          batched.setMaterialAt(slot, material);
          batched.setMatrixAt(slot, matrix);
          batched.setPassesAt(slot, RenderPassBit.OPAQUE);
        }
        batched.setMatrixAt(0, matrix.makeTranslation(-1, 0, 0));
        batched.setMatrixAt(last, matrix.makeTranslation(1, 0, 0));
        batched.setInstanceDataAt(0, 'tint', 1, 0, 0, 1);
        batched.setInstanceDataAt(last, 'tint', 0, 1, 0, 1);
        view3d.root.addChild(batched);
        app.stage.addChild(view3d);

        await renderFrame(app);
        batched.setVisibleAt(0, false);
        expect(coloursAcross(await renderFrame(app)), 'the last slot keeps its row with the first hidden').toEqual([
          '010',
        ]);

        batched.setVisibleAt(0, true);
        for (let slot = 1; slot <= 10; slot++) batched.setVisibleAt(slot, false);
        expect(coloursAcross(await renderFrame(app)), 'and with off-screen slots between them hidden').toEqual([
          '100',
          '010',
        ]);

        view3d.destroy({ children: true });
      } finally {
        app.destroy();
      }
    });

    it('uploads the instance store only when instance data changed', async () => {
      const app = await getApp<Renderer>({ id: `batched-instance-upload-${preference}`, appOptions });

      try {
        const view3d = createView();
        const batched = new BatchedMesh3D({ size: 4, instanceData: TINT_DATA });
        cubeRow(batched, new FlatMaterial({ extraBits: [tintBit] }));
        view3d.root.addChild(batched);
        app.stage.addChild(view3d);
        await renderFrame(app);

        const views = batched.batch.instanceStoreBuffer as unknown as StoreViews;
        const gpuView = preference === 'webgpu' ? views._buffer! : views._textureSource!;
        const upload = vi.spyOn(gpuView, 'update');

        batched.setMatrixAt(0, new Matrix4().makeTranslation(-3, 0.5, 0));
        batched.matrices.update();
        await renderFrame(app);
        expect(upload, 'a frame of matrix writes sends no instance data').not.toHaveBeenCalled();

        batched.setInstanceDataAt(2, 'tint', 1, 0, 0, 1);
        await renderFrame(app);
        expect(upload).toHaveBeenCalledTimes(1);

        view3d.destroy({ children: true });
      } finally {
        app.destroy();
      }
    });

    it('compiles one shader per layout a material reads, and leaves the others as they were', async () => {
      const app = await getApp<Renderer>({ id: `batched-instance-keys-${preference}`, appOptions });

      try {
        const view3d = createView();
        const reading = new FlatMaterial({ extraBits: [tintBit] });
        const blind = new FlatMaterial();
        const wider = { ...TINT_DATA, extra: { value: [0, 0, 0, 0], type: 'vec4<f32>' } } as const;

        const a = new BatchedMesh3D({ size: 1, instanceData: TINT_DATA });
        const b = new BatchedMesh3D({ size: 1, instanceData: TINT_DATA });
        const c = new BatchedMesh3D({ size: 1, instanceData: wider });
        const d = new BatchedMesh3D({ size: 1, instanceData: wider });
        const e = new BatchedMesh3D({ size: 1 });
        const cube = cubeRow(a, reading);
        cubeRow(b, reading);
        cubeRow(c, reading);
        cubeRow(d, blind);
        cubeRow(e, blind);
        const mesh = new Mesh3D({ geometry: cube, material: blind });
        view3d.root.addChild(a, b, c, d, e, mesh);
        app.stage.addChild(view3d);
        await renderFrame(app);

        expect(shaderOf(a)).toBe(shaderOf(b));
        expect(shaderOf(a)).not.toBe(shaderOf(c));
        expect(shaderOf(d), 'a material that reads no instance data ignores what the batch declares').toBe(shaderOf(e));
        expect(shaderOf(e), 'and gets the shader a scene mesh gets').toBe(mesh._passCache[RenderPassBit.OPAQUE].shader);

        expect(sourceOf(shaderOf(a))).toMatch(/uInstanceStor/);
        expect(sourceOf(shaderOf(e))).not.toMatch(/\bgetInstance\b|\bInstance\b|\binstance\b|uInstanceStor|vInstance_/);

        view3d.destroy({ children: true });
      } finally {
        app.destroy();
      }
    });

    it('throws when a bit reads instance data the mesh does not have, naming the bit', async () => {
      const app = await getApp<Renderer>({ id: `batched-instance-errors-${preference}`, appOptions });

      try {
        const cube = new CubeGeometry({ width: 1, height: 1, depth: 1 });

        const plainView = createView();
        plainView.root.addChild(new Mesh3D({ geometry: cube, material: new FlatMaterial({ extraBits: [tintBit] }) }));
        app.stage.addChild(plainView);
        expect(() => app.render()).toThrow(/"testInstanceTint" reads instance data, but the mesh it draws has none/);
        app.stage.removeChild(plainView);

        const partView = createView();
        const part = new BatchedMesh3D({ size: 1, instanceData: { tint: TINT_DATA.tint } });
        cubeRow(part, new FlatMaterial({ extraBits: [tintBit] }));
        partView.root.addChild(part);
        app.stage.addChild(partView);
        expect(() => app.render()).toThrow(/instance\.shape as vec4<f32>, but the batch has no such field/);
        app.stage.removeChild(partView);

        const typeView = createView();
        const mistyped = new BatchedMesh3D({
          size: 1,
          instanceData: { tint: TINT_DATA.tint, shape: { value: [1, 0, 0, 0], type: 'vec4<u32>' } },
        });
        cubeRow(mistyped, new FlatMaterial({ extraBits: [tintBit] }));
        typeView.root.addChild(mistyped);
        app.stage.addChild(typeView);
        expect(() => app.render()).toThrow(/instance\.shape as vec4<f32>, but the batch declares it as vec4<u32>/);
        app.stage.removeChild(typeView);
      } finally {
        app.destroy();
      }
    });

    it('frees the instance store on unload and rebuilds it on the next render', async () => {
      const app = await getApp<Renderer>({ id: `batched-instance-unload-${preference}`, appOptions });

      try {
        const view3d = createView();
        const batched = new BatchedMesh3D({ size: 3, instanceData: TINT_DATA });
        cubeRow(batched, new FlatMaterial({ extraBits: [tintBit] }));
        batched.setInstanceDataAt(0, 'tint', 1, 0, 0, 1);
        batched.setInstanceDataAt(1, 'tint', 0, 1, 0, 1);
        batched.setInstanceDataAt(2, 'tint', 0, 0, 1, 1);
        view3d.root.addChild(batched);
        app.stage.addChild(view3d);
        const store = batched.batch.instanceStoreBuffer!;

        await renderFrame(app);
        expect(gpuCopies(store)).toBe(1);

        batched.unload();
        batched.unload();
        expect(gpuCopies(store), 'unload gave the GPU copy back').toBe(0);
        expect(store.data, 'and kept the CPU rows').not.toBe(null);

        batched.setInstanceDataAt(2, 'tint', 1, 1, 0, 1);
        expect(
          coloursAcross(await renderFrame(app)),
          'the rebuilt copy holds the rows, with the write made while unloaded',
        ).toEqual(['100', '010', '110']);
        expect(gpuCopies(store)).toBe(1);

        view3d.destroy({ children: true });
      } finally {
        app.destroy();
      }
    });

    it('frees the instance store on destroy, and the view keeps drawing its other batches', async () => {
      const app = await getApp<Renderer>({ id: `batched-instance-destroy-${preference}`, appOptions });

      try {
        const view3d = createView();
        const material = new FlatMaterial({ extraBits: [tintBit] });
        const doomed = new BatchedMesh3D({ size: 1, instanceData: TINT_DATA });
        const kept = new BatchedMesh3D({ size: 2, instanceData: TINT_DATA });
        cubeRow(doomed, material);
        cubeRow(kept, material);
        doomed.setInstanceDataAt(0, 'tint', 0, 1, 0, 1);
        for (let i = 0; i < 2; i++) kept.setInstanceDataAt(i, 'tint', 1, 0, 0, 1);
        view3d.root.addChild(kept, doomed);
        app.stage.addChild(view3d);
        const store = doomed.batch.instanceStoreBuffer!;
        const { name } = INSTANCE_BINDING[preference];

        expect(coloursAcross(await renderFrame(app))).toEqual(['100', '010', '100']);
        expect(gpuCopies(store)).toBe(1);

        const { globalBindGroup } = view3d._gpuData[app.renderer.uid];
        const bound = preference === 'webgpu' ? store.bufferResource : store.texture.source;
        expect(globalBindGroup.getResource(name), 'the doomed batch drew last, so the group holds its store').toBe(
          bound,
        );

        destroyQuietly(doomed);

        expect(gpuCopies(store)).toBe(0);
        expect(store.data).toBe(null);
        expect(doomed.batch.instanceStoreBuffer).toBe(null);
        expect(globalBindGroup.getResource(name), 'the bind group let go of the dead store').not.toBe(bound);

        expect(coloursAcross(await renderFrame(app))).toEqual(['100', '100']);

        view3d.destroy({ children: true });
      } finally {
        app.destroy();
      }
    });

    it('binds the instance store by name, in a group a shader without it shares', async () => {
      const app = await getApp<Renderer>({ id: `batched-instance-slot-${preference}`, appOptions });

      try {
        const view3d = createView();
        const reading = new BatchedMesh3D({ size: 2, instanceData: TINT_DATA });
        const plain = new BatchedMesh3D({ size: 1 });
        cubeRow(reading, new FlatMaterial({ extraBits: [tintBit] }));
        cubeRow(plain, new FlatMaterial());
        view3d.root.addChild(reading, plain);
        app.stage.addChild(view3d);

        expect(coloursIn(await renderFrame(app)), 'both batches draw from the one global group').toEqual(
          new Set(['111']),
        );

        const { name, meshStore } = INSTANCE_BINDING[preference];
        const { globalBindGroup } = view3d._gpuData[app.renderer.uid];
        const names = Object.values(globalBindings(shaderOf(reading)));
        const plainNames = Object.values(globalBindings(shaderOf(plain)));

        expect(names).toContain(name);
        expect(names).toContain(meshStore);
        expect(plainNames, 'a shader that reads no instance data has no such binding').not.toContain(name);
        expect(Object.keys(globalBindGroup.layout!), 'the group names every binding either shader declares').toEqual(
          expect.arrayContaining(names),
        );

        const entry = shaderOf(reading).gpuProgram?.gpuLayout[0].find(
          (e) => e.binding === shaderOf(reading).gpuProgram.layout[0][name],
        );
        expect(entry?.visibility, 'WebGPU shows the store to the vertex stage alone').toBe(
          preference === 'webgpu' ? ShaderStage.VERTEX : undefined,
        );
        expect(fragmentCode(shaderOf(reading)), 'the fragment stage never reads the store').not.toMatch(
          /getInstance|uInstanceStorage|texelFetch\(uInstanceStoreTexture/,
        );

        expect(
          globalBindGroup.getResource(name),
          'the plain batch bound last, so the binding went back to the placeholder',
        ).toBe(preference === 'webgpu' ? EMPTY_BUFFER_RESOURCE : UINT_EMPTY.source);

        plain.visible = false;
        reading.batch.invalidateDrawCaches();
        await renderFrame(app);
        const store = reading.batch.instanceStoreBuffer!;
        expect(globalBindGroup.getResource(name), 'bound alone, the reading batch leaves its own store there').toBe(
          preference === 'webgpu' ? store.bufferResource : store.texture.source,
        );

        view3d.destroy({ children: true });
      } finally {
        app.destroy();
      }
    });

    it('compiles a custom template that has the instance slots, and names the slot one lacks', async () => {
      const app = await getApp<Renderer>({ id: `instance-data-template-${preference}`, appOptions });

      try {
        const view3d = createView();
        const batched = new BatchedMesh3D({
          size: 1,
          instanceData: { tint: { value: [1, 0, 0, 1], type: 'vec4<f32>' } },
        });
        const material = new FlatMaterial();
        const cube = cubeRow(batched, material);
        view3d.root.addChild(batched);
        app.stage.addChild(view3d);
        await renderFrame(app);

        const { material3d } = app.renderer as unknown as {
          material3d: { compileShader(descriptor: ShaderDescriptor, mesh: unknown, batch: unknown): Shader };
        };
        const descriptor = (slots: boolean): ShaderDescriptor =>
          new ShaderDescriptor({
            bitsGpu: [customPassBit],
            bitsGl: [instanceFetchBitGl, customPassBit],
            template: customTemplate(slots),
          });

        const shader = material3d.compileShader(descriptor(true), batched.batch.items[0], batched.batch);

        let compileLog: string;
        if (shader.gpuProgram) {
          const { device } = (app.renderer as WebGPURenderer).gpu;
          compileLog = (await wgslCompilationErrors(device, shader.gpuProgram.vertex!.source)).join('\n');
        } else {
          const { gl } = app.renderer as WebGLRenderer;
          compileLog =
            glslCompileLog(gl, gl.VERTEX_SHADER, shader.glProgram.vertex!) +
            glslCompileLog(gl, gl.FRAGMENT_SHADER, shader.glProgram.fragment!);
        }

        expect(compileLog).toBe('');
        expect(sourceOf(shader)).toContain(
          preference === 'webgpu'
            ? 'let instance = getInstance(inst.id);'
            : 'Instance instance = getInstance(renderInstance.x);',
        );

        expect(() => material3d.compileShader(descriptor(false), batched.batch.items[0], batched.batch)).toThrow(
          preference === 'webgpu' ? /no \{\{vertexStoreAccess\}\}/ : /no \{\{storeAccess\}\} in its vertex source/,
        );

        destroyQuietly(batched);
        cube.destroy(true);
        material.destroy();
        view3d.destroy({ children: true });
      } finally {
        app.destroy();
      }
    });
  });
}
