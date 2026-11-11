import { getApp, renderFrame } from '@test-utils';
import type { Application, BufferResource, Renderer, WebGLRenderer, WebGPURenderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { MERGE_THRESHOLD } from '~/core/batcher/batchConstants';
import { DATA_TEXTURE_WIDTH } from '~/core/buffers/dataTextureLayout';
import { BUFFER_CALL_BYTES } from '~/core/buffers/DirtySlots';
import type { MaterialDataStoreBuffer } from '~/core/buffers/MaterialDataStoreBuffer';
import { MESH3D_STORE_STRIDE } from '~/core/buffers/Mesh3DDataStoreBuffer';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Geometry3D } from '~/geometry/Geometry3D';
import type { BaseMaterial3D } from '~/materials/BaseMaterial3D';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { Skeleton } from '~/scene/Skeleton';
import { View3D } from '~/scene/View3D';

const SIZE = 64;

const FAR_APART_MESHES = 500;

const FILLER_INSTANCES = 40;

const INDEX_TEXTURE_GROWTH = 300;

const BATCH_SLOTS = 1000;

const TINT_PADS = 29;

const tintBit: ShaderBit = {
  name: 'storeUploadTint',
  bindings: {
    material: Object.fromEntries([
      ...Array.from({ length: TINT_PADS }, (_, i) => [`pad${i}`, 'vec4<f32>'] as const),
      ['tint', 'vec4<f32>'] as const,
    ]),
  },
  gpu: { fragment: { material: /* wgsl */ `  albedo += material.tint.rgb;\n` } },
  gl: { fragment: { material: /* glsl */ `  albedo += material.tint.rgb;\n` } },
};

function crossingSlotAt(material: FlatMaterial, alignment: number): number {
  const placeTexels = (Math.ceil(material.data._f32.byteLength / alignment) * alignment) / 16;
  const tintTexel = (material.data.tint as Float32Array).byteOffset / 16;
  for (let slot = 0; slot * placeTexels < DATA_TEXTURE_WIDTH; slot++) {
    if (slot * placeTexels + tintTexel >= DATA_TEXTURE_WIDTH) return slot;
  }
  throw new Error(`no place of ${placeTexels} texels crosses the row at alignment ${alignment}`);
}

function rgbAt(pixels: Uint8ClampedArray, canvasWidth: number, x: number, y: number): number[] {
  const i = (y * canvasWidth + x) * 4;

  return [pixels[i], pixels[i + 1], pixels[i + 2]];
}

function skinnedQuad(jointCount: number, color: number): Mesh3D {
  const geometry = new Geometry3D({
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    joints: new Uint8Array(16),
    weights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  });
  const inverseBindMatrices = new Float32Array(jointCount * 16);
  for (let i = 0; i < jointCount; i++) {
    inverseBindMatrices.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], i * 16);
  }

  return new Mesh3D({
    geometry,
    material: new FlatMaterial({ baseColor: color }),
    skeleton: new Skeleton({
      parent: new Int16Array(jointCount).fill(-1),
      joints: new Int16Array(jointCount).map((_, i) => i),
      inverseBindMatrices,
    }),
  });
}

function materialStore(app: Application<Renderer>): MaterialDataStoreBuffer {
  return (app.renderer as WebGLRenderer | WebGPURenderer).renderPipes.view3d.materialStoreBuffer;
}

function boundRow(material: BaseMaterial3D): BufferResource {
  return material._getBindGroup().getResource(material._textures.length * 2) as BufferResource;
}

function bufferRow(resource: BufferResource, material: BaseMaterial3D): number[] {
  const data = resource.buffer.data as Float32Array;

  return Array.from(new Float32Array(data.buffer, data.byteOffset + resource.offset, material.data._f32.length));
}

function addOffscreen(view3d: View3D, store: MaterialDataStoreBuffer): void {
  const capacity = store.data.length / 4;
  let texels = 0;
  while (texels <= capacity) {
    const material = new FlatMaterial({ baseColor: 0xffffff });
    texels += material.data._f32.length / 4;
    const mesh = new Mesh3D({ geometry: new CubeGeometry({ width: 0.1, height: 0.1, depth: 0.1 }), material });
    mesh.position.set(0, 500, 0);
    view3d.root.addChild(mesh);
  }
}

function mergedRun(view3d: View3D): { right: FlatMaterial } {
  const geometry = new CubeGeometry({ width: 0.6, height: 0.6, depth: 0.6 });
  const count = MERGE_THRESHOLD + 1;
  let right!: FlatMaterial;
  for (let i = 0; i < count; i++) {
    right = new FlatMaterial({ baseColor: i === count - 1 ? 0x0000ff : 0xff0000 });
    const mesh = new Mesh3D({ geometry, material: right });
    mesh.position.set((i - (count - 1) / 2) * 0.8, 0, 0);
    view3d.root.addChild(mesh);
  }
  view3d.camera.position.set(0, 0, 6);

  return { right };
}

function twoCubes(view3d: View3D): { left: FlatMaterial; right: FlatMaterial } {
  const geometry = new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 });
  const left = new FlatMaterial({ baseColor: 0xff0000 });
  const right = new FlatMaterial({ baseColor: 0x0000ff });
  const a = new Mesh3D({ geometry, material: left });
  const b = new Mesh3D({ geometry, material: right });
  a.position.set(-1.2, 0, 0);
  b.position.set(1.2, 0, 0);
  view3d.root.addChild(a, b);
  view3d.camera.position.set(0, 0, 6);

  return { left, right };
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`store uploads reach the GPU (${preference})`, () => {
    const appOptions = { preference, width: SIZE, height: SIZE, resolution: 1, backgroundColor: 0x000000 };

    it.runIf(preference === 'webgpu')(
      'a material changed after the first frame reaches the GPU through its row, and its neighbour keeps its row',
      async () => {
        const app = await getApp({ id: `store-upload-material-${preference}`, appOptions });

        try {
          const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE });
          app.stage.addChild(view3d);
          const { left, right } = twoCubes(view3d);

          let pixels = await renderFrame(app);
          expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
          expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([0, 0, 255]);

          const store = materialStore(app);
          const opaque = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE].commandList;
          const commands = opaque.commands.slice(0, opaque.count);
          expect(
            commands.filter((cmd) => cmd.batchBindGroup === right._getBindGroup()).length,
            'one command binds the material',
          ).toBe(1);
          expect(boundRow(right), "the command's group binds the store's row for it").toBe(
            store.uniformResource(right),
          );
          expect(boundRow(left)).toBe(store.uniformResource(left));
          expect(boundRow(left)).not.toBe(boundRow(right));

          right.baseColor = 0x00ff00;
          pixels = await renderFrame(app);

          expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
          expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([0, 255, 0]);
          expect(bufferRow(boundRow(right), right), 'the row holds the change').toEqual(Array.from(right.data._f32));
          expect(bufferRow(boundRow(left), left)).toEqual(Array.from(left.data._f32));

          view3d.destroy({ children: true });
        } finally {
          app.destroy();
        }
      },
    );

    it.runIf(preference === 'webgl')(
      'a material changed after the first frame reaches the GPU through the store texture of a merged draw',
      async () => {
        const app = await getApp({ id: `store-upload-material-merged-${preference}`, appOptions });

        try {
          const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE });
          app.stage.addChild(view3d);
          const { right } = twoCubes(view3d);

          let pixels = await renderFrame(app);
          expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
          expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([0, 0, 255]);
          const opaque = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE].commandList;
          expect(opaque.count, 'both materials draw as one merged command').toBe(1);

          right.baseColor = 0x00ff00;
          pixels = await renderFrame(app);

          expect(rgbAt(pixels, SIZE, 21, 32), 'the neighbour keeps its row').toEqual([255, 0, 0]);
          expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([0, 255, 0]);

          view3d.destroy({ children: true });
        } finally {
          app.destroy();
        }
      },
    );

    it('growth after the first frame keeps what the stores held and takes new writes', async () => {
      const app = await getApp({ id: `store-upload-growth-${preference}`, appOptions });

      try {
        const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE });
        app.stage.addChild(view3d);
        const { right } = twoCubes(view3d);

        let pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([0, 0, 255]);

        const meshVersion = view3d._sceneBatch.storeBuffer.bufferVersion;
        const materialVersion = materialStore(app).bufferVersion;
        addOffscreen(view3d, materialStore(app));
        right.baseColor = 0x00ff00;
        pixels = await renderFrame(app);

        expect(view3d._sceneBatch.storeBuffer.bufferVersion).toBeGreaterThan(meshVersion);
        expect(materialStore(app).bufferVersion).toBeGreaterThan(materialVersion);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([0, 255, 0]);

        right.baseColor = 0xffff00;
        pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32), 'a later partial write lands in the grown resource').toEqual([255, 255, 0]);

        view3d.destroy({ children: true });
      } finally {
        app.destroy();
      }
    });

    it('a change and growth made after an unload reach the GPU on the next frame', async () => {
      const app = await getApp({ id: `store-upload-unload-${preference}`, appOptions });

      try {
        const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE });
        app.stage.addChild(view3d);
        const { right } = twoCubes(view3d);
        await renderFrame(app);

        view3d.unload();
        right.baseColor = 0x00ff00;
        let pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([0, 255, 0]);

        view3d.unload();
        const materialVersion = materialStore(app).bufferVersion;
        addOffscreen(view3d, materialStore(app));
        right.baseColor = 0xffff00;
        pixels = await renderFrame(app);
        expect(materialStore(app).bufferVersion).toBeGreaterThan(materialVersion);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([255, 255, 0]);

        view3d.destroy({ children: true });
      } finally {
        app.destroy();
      }
    });

    it('a second view growing the shared stores mid-frame leaves the first view intact', async () => {
      const app = await getApp({
        id: `store-upload-shared-${preference}`,
        appOptions: { ...appOptions, width: SIZE * 2 },
      });

      try {
        const viewA = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE });
        const viewB = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE });
        viewB.x = SIZE;
        app.stage.addChild(viewA, viewB);
        const a = twoCubes(viewA);
        const b = twoCubes(viewB);

        await renderFrame(app);

        const materialVersion = materialStore(app).bufferVersion;
        addOffscreen(viewB, materialStore(app));
        a.right.baseColor = 0x00ff00;
        b.right.baseColor = 0xff00ff;
        const pixels = await renderFrame(app);

        expect(materialStore(app).bufferVersion).toBeGreaterThan(materialVersion);
        expect(rgbAt(pixels, SIZE * 2, 21, 32)).toEqual([255, 0, 0]);
        expect(
          rgbAt(pixels, SIZE * 2, 43, 32),
          "B grows the shared stores after A has drawn, and A's change still lands",
        ).toEqual([0, 255, 0]);
        expect(rgbAt(pixels, SIZE * 2, 21 + SIZE, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE * 2, 43 + SIZE, 32)).toEqual([255, 0, 255]);

        viewA.destroy({ children: true });
        viewB.destroy({ children: true });
      } finally {
        app.destroy();
      }
    });

    it('bone pit growth inside add() still uploads every bone', async () => {
      const app = await getApp({ id: `store-upload-bones-${preference}`, appOptions });

      try {
        const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE });
        app.stage.addChild(view3d);
        const first = skinnedQuad(2, 0xff0000);
        first.position.set(-1.2, 0, 0);
        view3d.root.addChild(first);
        view3d.camera.position.set(0, 0, 6);

        let pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);

        const second = skinnedQuad(300, 0x0000ff);
        second.position.set(1.2, 0, 0);
        view3d.root.addChild(second);
        const version = view3d._bonePit.bufferVersion;
        pixels = await renderFrame(app);

        expect(view3d._bonePit.bufferVersion).toBeGreaterThan(version);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([0, 0, 255]);

        pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([0, 0, 255]);

        view3d.destroy({ children: true });
      } finally {
        app.destroy();
      }
    });

    it('instances hidden, shown or moved after the first frame draw in the right place', async () => {
      const app = await getApp({ id: `store-upload-instances-${preference}`, appOptions });

      try {
        const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE, cull: 'cpu' });
        app.stage.addChild(view3d);
        view3d.camera.position.set(0, 0, 6);

        const geometry = new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 });
        const material = new FlatMaterial({ baseColor: 0xff0000 });
        const left = new Mesh3D({ geometry, material });
        const right = new Mesh3D({ geometry, material });
        left.position.set(-1.2, 0, 0);
        right.position.set(1.2, 0, 0);
        view3d.root.addChild(left, right);
        for (let i = 0; i < FILLER_INSTANCES; i++) {
          const mesh = new Mesh3D({ geometry, material });
          mesh.position.set(0, 500, 0);
          view3d.root.addChild(mesh);
        }

        let pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([255, 0, 0]);

        left.visible = false;
        pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([0, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([255, 0, 0]);

        left.visible = true;
        right.visible = false;
        pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([0, 0, 0]);

        right.visible = true;
        left.position.set(0, 500, 0);
        pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([0, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([255, 0, 0]);

        for (let i = 0; i < INDEX_TEXTURE_GROWTH; i++) {
          const mesh = new Mesh3D({ geometry, material });
          mesh.position.set(0, 500, 0);
          view3d.root.addChild(mesh);
        }
        left.position.set(-1.2, 0, 0);
        pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([255, 0, 0]);

        right.visible = false;
        pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([0, 0, 0]);

        view3d.destroy({ children: true });
      } finally {
        app.destroy();
      }
    });

    it('two batches that share a shader each draw at their own world matrix, every frame', async () => {
      const app = await getApp({ id: `store-upload-batch-matrix-${preference}`, appOptions });

      try {
        const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE });
        app.stage.addChild(view3d);
        view3d.camera.position.set(0, 0, 6);

        const geometry = new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 });
        const [red, blue] = [0xff0000, 0x0000ff].map((baseColor) => {
          const batched = new BatchedMesh3D({ size: 1, parent: view3d.root });
          batched.setGeometryAt(0, geometry);
          batched.setMaterialAt(0, new FlatMaterial({ baseColor }));
          batched.setMatrixAt(0, new Matrix4());
          batched.setPassesAt(0, RenderPassBit.OPAQUE);

          return batched;
        });
        red.position.set(-1.2, 0, 0);
        blue.position.set(1.2, 0, 0);

        let pixels = await renderFrame(app);
        expect(red.batch.items[0]._passCache[RenderPassBit.OPAQUE].shader, 'one shader draws both batches').toBe(
          blue.batch.items[0]._passCache[RenderPassBit.OPAQUE].shader,
        );
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([0, 0, 255]);

        red.position.set(1.2, 0, 0);
        blue.position.set(-1.2, 0, 0);
        pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32), 'the swapped matrices reach the next frame').toEqual([0, 0, 255]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([255, 0, 0]);

        view3d.destroy({ children: true });
      } finally {
        app.destroy();
      }
    });

    it('scattered slot changes at both ends of a large batch all reach the GPU in one frame', async () => {
      const app = await getApp({ id: `store-upload-runs-${preference}`, appOptions });

      try {
        const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE });
        app.stage.addChild(view3d);
        view3d.camera.position.set(0, 0, 6);

        const geometry = new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 });
        const red = new FlatMaterial({ baseColor: 0xff0000 });
        const blue = new FlatMaterial({ baseColor: 0x0000ff });
        const last = BATCH_SLOTS - 1;
        const batched = new BatchedMesh3D({ size: BATCH_SLOTS });
        const matrix = new Matrix4().makeTranslation(0, 500, 0);
        for (let i = 0; i < BATCH_SLOTS; i++) {
          batched.setMatrixAt(i, matrix);
          batched.setGeometryAt(i, geometry);
          batched.setMaterialAt(i, i === last ? blue : red);
          batched.setPassesAt(i, RenderPassBit.OPAQUE);
        }
        batched.setMatrixAt(0, matrix.makeTranslation(-1.2, 0, 0));
        batched.setMatrixAt(last, matrix.makeTranslation(1.2, 0, 0));
        view3d.root.addChild(batched);

        let pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([0, 0, 255]);

        batched.setMatrixAt(0, matrix.makeTranslation(1.2, 0, 0));
        batched.setMatrixAt(last, matrix.makeTranslation(-1.2, 0, 0));
        pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32), 'the last slot moved left').toEqual([0, 0, 255]);
        expect(rgbAt(pixels, SIZE, 43, 32), 'the first slot moved right').toEqual([255, 0, 0]);

        batched.setVisibleAt(0, false);
        batched.setVisibleAt(last, false);
        pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32), 'the last slot is hidden').toEqual([0, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32), 'the first slot is hidden').toEqual([0, 0, 0]);

        batched.setVisibleAt(0, true);
        batched.setVisibleAt(last, true);
        pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32), 'the last slot is shown').toEqual([0, 0, 255]);
        expect(rgbAt(pixels, SIZE, 43, 32), 'the first slot is shown').toEqual([255, 0, 0]);

        view3d.destroy({ children: true, geometry: true, material: true });
      } finally {
        app.destroy();
      }
    });

    it('materials far apart, one crossing the first texture row, change in one frame and upload a call each', async () => {
      const app = await getApp({ id: `store-upload-row-cross-${preference}`, appOptions });

      try {
        const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE });
        app.stage.addChild(view3d);
        view3d.camera.position.set(0, 0, 6);

        const tinted = (): FlatMaterial => new FlatMaterial({ extraBits: [tintBit] });
        const materials = [tinted()];
        const crossingSlot = crossingSlotAt(
          materials[0],
          (app.renderer as WebGLRenderer | WebGPURenderer).limits.minUniformBufferOffsetAlignment,
        );
        while (materials.length <= crossingSlot) materials.push(tinted());

        const geometry = new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 });
        const batched = new BatchedMesh3D({ size: materials.length });
        const matrix = new Matrix4().makeTranslation(0, 500, 0);
        for (let i = 0; i < materials.length; i++) {
          batched.setMatrixAt(i, matrix);
          batched.setGeometryAt(i, geometry);
          batched.setMaterialAt(i, materials[i]);
          batched.setPassesAt(i, RenderPassBit.OPAQUE);
        }
        batched.setMatrixAt(0, matrix.makeTranslation(-1.2, 0, 0));
        batched.setMatrixAt(crossingSlot, matrix.makeTranslation(1.2, 0, 0));
        view3d.root.addChild(batched);

        const first = materials[0];
        const crossing = materials[crossingSlot];
        for (const material of [first, crossing]) {
          material.baseColor = 0xff0000;
          material.data.tint = [0, 1, 0, 0];
        }

        let pixels = await renderFrame(app);
        const texelOf = (field: Float32Array): number => crossing._materialIndex + field.byteOffset / 16;
        expect(texelOf(crossing.data.baseColor!), 'baseColor before the row ends').toBeLessThan(DATA_TEXTURE_WIDTH);
        expect(texelOf(crossing.data.tint as Float32Array), 'tint after it').toBeGreaterThanOrEqual(DATA_TEXTURE_WIDTH);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 255, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32), 'the crossing place reads from both rows').toEqual([255, 255, 0]);

        const update = vi.spyOn(materialStore(app).texture.source, 'update');
        for (const material of [first, crossing]) {
          material.baseColor = 0x0000ff;
          material.data.tint = [1, 0, 0, 0];
        }
        pixels = await renderFrame(app);

        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 255]);
        expect(rgbAt(pixels, SIZE, 43, 32), 'both rows of the crossing place reach the GPU').toEqual([255, 0, 255]);
        expect(update, 'two places this far apart upload as a call each, not as one span').toHaveBeenCalledTimes(2);

        view3d.destroy({ children: true, geometry: true, material: true });
      } finally {
        app.destroy();
      }
    });
  });
}

describe('uniform rows on WebGL', () => {
  it('two materials dirty in one frame mark one span but never reach a GL uniform buffer, and draw their new colours from the store texture', async () => {
    const app = await getApp<WebGLRenderer>({
      id: 'store-upload-gl-row-span',
      appOptions: { preference: 'webgl', width: SIZE, height: SIZE, resolution: 1, backgroundColor: 0x000000 },
    });

    try {
      const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE });
      app.stage.addChild(view3d);
      const { left, right } = twoCubes(view3d);

      let pixels = await renderFrame(app);
      expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
      expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([0, 0, 255]);

      const store = materialStore(app);
      const a = store.uniformResource(left);
      const b = store.uniformResource(right);
      expect(a.buffer, 'both rows live in the one store buffer').toBe(b.buffer);
      const low = Math.min(a.offset, b.offset);
      const span = Math.max(a.offset, b.offset) + left.data._f32.byteLength - low;

      const gl = app.renderer.gl;
      const update = vi.spyOn(a.buffer, 'update');
      const sub = vi.spyOn(gl, 'bufferSubData');
      left.baseColor = 0x00ff00;
      right.baseColor = 0xffff00;
      pixels = await renderFrame(app);

      expect(update.mock.calls, 'one span from the lower row to the end of the higher').toEqual([[span, low]]);
      expect(
        sub.mock.calls.filter((call) => call[0] === gl.UNIFORM_BUFFER && call[1] === low && call[4] === span / 4),
        'nothing binds the rows as a uniform block on WebGL, so nothing uploads them',
      ).toHaveLength(0);
      expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([0, 255, 0]);
      expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([255, 255, 0]);

      view3d.destroy({ children: true });
    } finally {
      app.destroy();
    }
  });
});

describe('uniform rows upload as runs (webgpu)', () => {
  it('two dirty rows far apart upload as a write each, each drawing its new colour', async () => {
    const app = await getApp<WebGPURenderer>({
      id: 'store-upload-gpu-row-runs',
      appOptions: { preference: 'webgpu', width: SIZE, height: SIZE, resolution: 1, backgroundColor: 0x000000 },
    });

    try {
      const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE });
      app.stage.addChild(view3d);
      const { left, right } = twoCubes(view3d);

      const store = materialStore(app);
      const alignment = app.renderer.limits.minUniformBufferOffsetAlignment;
      const rowBytes = left.data._f32.byteLength;
      const placeBytes = Math.ceil(rowBytes / alignment) * alignment;
      store.register(left);
      const fillers: FlatMaterial[] = [];
      for (let i = 0, n = Math.ceil((2 * BUFFER_CALL_BYTES + 2 * rowBytes) / placeBytes) + 1; i < n; i++) {
        const filler = new FlatMaterial();
        store.register(filler);
        fillers.push(filler);
      }
      store.register(right);

      let pixels = await renderFrame(app);
      expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
      expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([0, 0, 255]);

      const a = boundRow(left);
      const b = boundRow(right);
      expect(b.offset - a.offset).toBeGreaterThan(2 * BUFFER_CALL_BYTES + 2 * rowBytes);

      const update = vi.spyOn(a.buffer, 'update');
      left.baseColor = 0x00ff00;
      right.baseColor = 0xffff00;
      pixels = await renderFrame(app);

      expect(update.mock.calls, 'a write per row').toEqual([
        [rowBytes, a.offset],
        [rowBytes, b.offset],
      ]);
      expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([0, 255, 0]);
      expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([255, 255, 0]);

      view3d.destroy({ children: true });
      for (const m of fillers) m.destroy();
    } finally {
      app.destroy();
    }
  });
});

describe('store uploads are partial (webgl)', () => {
  it("a one-material change uploads that material's texels (a merged run, whose shader reads the store texture)", async () => {
    const app = await getApp<WebGLRenderer>({
      id: 'store-upload-gl-rect',
      appOptions: { preference: 'webgl', width: SIZE, height: SIZE, resolution: 1, backgroundColor: 0x000000 },
    });

    try {
      const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE });
      app.stage.addChild(view3d);
      const { right } = mergedRun(view3d);
      app.render();
      expect(view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE].commandList.count, 'one merged draw').toBe(1);

      const gl = app.renderer.gl;
      const sub = vi.spyOn(gl, 'texSubImage2D');
      const full = vi.spyOn(gl, 'texImage2D');

      right.baseColor = 0x00ff00;
      app.render();

      const sizes = sub.mock.calls.filter((call) => call[6] === gl.RGBA_INTEGER).map((call) => [call[4], call[5]]);
      const wholeTexels = app.renderer.renderPipes.view3d.materialStoreBuffer.data.length / 4;
      const materialTexels = right.data._f32.length / 4;

      expect(sizes.some(([width, height]) => width === materialTexels && height === 1)).toBe(true);
      expect(sizes.some(([width]) => width === wholeTexels)).toBe(false);
      expect(full).not.toHaveBeenCalled();

      view3d.destroy({ children: true });
    } finally {
      app.destroy();
    }
  });

  it('a hide and a move at opposite ends of the scene upload their two rows, not the rows between', async () => {
    const app = await getApp<WebGLRenderer>({
      id: 'store-upload-gl-visibility-run',
      appOptions: { preference: 'webgl', width: SIZE, height: SIZE, resolution: 1, backgroundColor: 0x000000 },
    });

    try {
      const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE });
      app.stage.addChild(view3d);
      view3d.camera.position.set(0, 0, 6);
      const geometry = new CubeGeometry({ width: 0.1, height: 0.1, depth: 0.1 });
      const material = new FlatMaterial({ baseColor: 0xffffff });
      const meshes: Mesh3D[] = [];
      for (let i = 0; i < FAR_APART_MESHES; i++) {
        meshes.push(view3d.root.addChild(new Mesh3D({ geometry, material })));
      }
      app.render();

      const gl = app.renderer.gl;
      const sub = vi.spyOn(gl, 'texSubImage2D');

      meshes[0].visible = false;
      meshes[FAR_APART_MESHES - 1].position.x = 1;
      app.render();

      const texels = sub.mock.calls
        .filter((call) => call[6] === gl.RGBA_INTEGER)
        .reduce((sum, call) => sum + call[4] * call[5], 0);

      expect(texels).toBe((2 * MESH3D_STORE_STRIDE) / 4);

      view3d.destroy({ children: true, geometry: true, material: true });
    } finally {
      app.destroy();
    }
  });
});
