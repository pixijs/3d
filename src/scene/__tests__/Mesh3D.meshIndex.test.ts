import { getApp, renderFrame } from '@test-utils';
import { describe, expect, it } from 'vitest';

import { MERGE_THRESHOLD } from '~/core/batcher/batchConstants';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const WIDTH = 320;
const HEIGHT = 16;

const meshIndexBit: ShaderBit = {
  name: 'testMeshIndexColor',
  interStage: { vTestMeshIndex: 'u32' },
  gpu: {
    vertex: { end: 'output.vTestMeshIndex = meshIndex;' },
    fragment: { material: 'albedo = vec3<f32>(f32(input.vTestMeshIndex) / 255.0, 1.0, 0.0);' },
  },
  gl: {
    vertex: { end: 'vTestMeshIndex = meshIndex;' },
    fragment: { material: 'albedo = vec3(float(vTestMeshIndex) / 255.0, 1.0, 0.0);' },
  },
};

function redOfGreenRunsAcross(pixels: Uint8ClampedArray): number[] {
  const row = pixels.subarray((HEIGHT >> 1) * WIDTH * 4, ((HEIGHT >> 1) + 1) * WIDTH * 4);
  const runs: number[] = [];
  let inRun = false;
  for (let p = 0; p < row.length; p += 4) {
    const drawn = row[p + 1] === 255;
    if (drawn && !inRun) runs.push(row[p]);
    inRun = drawn;
  }

  return runs;
}

function createView(count: number): View3D {
  const view3d = new View3D({ toneMapping: 'none', width: WIDTH, height: HEIGHT });
  view3d.camera.mode = 'orthographic';
  view3d.camera.orthographicSize = count + 1;
  view3d.camera.position.set(0, 0, 5);

  return view3d;
}

const xOf = (i: number, count: number): number => i - (count - 1) / 2;

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`meshIndex in a material's vertex code (${preference})`, () => {
    const appOptions = { preference, width: WIDTH, height: HEIGHT, resolution: 1, backgroundColor: 0x000000 };

    for (const shared of [true, false]) {
      const count = shared ? 4 : MERGE_THRESHOLD + 2;
      const materials = shared ? 'one shared material' : 'a material each, drawn merged on WebGPU';

      it(`reads each mesh's own meshIndex, the same every frame, with ${materials}`, async () => {
        const app = await getApp({ id: `mesh-index-${shared}-${preference}`, appOptions });

        try {
          const view3d = createView(count);
          app.stage.addChild(view3d);
          const geometry = new CubeGeometry({ width: 0.5, height: 0.5, depth: 0.5 });
          const sharedMaterial = new FlatMaterial({ extraBits: [meshIndexBit] });
          const meshes: Mesh3D[] = [];
          for (let i = 0; i < count; i++) {
            const material = shared ? sharedMaterial : new FlatMaterial({ extraBits: [meshIndexBit] });
            const mesh = new Mesh3D({ geometry, material });
            mesh.position.set(xOf(i, count), 0, 0);
            meshes.push(mesh);
          }
          view3d.root.addChild(...meshes);

          expect(meshes[0].meshIndex, 'a mesh has no number before its first render').toBe(-1);

          const first = redOfGreenRunsAcross(await renderFrame(app));
          const numbers = meshes.map((mesh) => mesh.meshIndex);

          expect(new Set(numbers).size, 'each mesh has its own number').toBe(count);
          expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0);
          expect(first, 'the shader reads the number the mesh reports').toEqual(numbers);
          expect(
            view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE].commandList.count,
            'the meshes draw as one command, instanced or merged',
          ).toBe(1);

          meshes[0].position.y = 0.1;
          expect(redOfGreenRunsAcross(await renderFrame(app)), 'a later frame reads the same numbers').toEqual(numbers);

          view3d.root.removeChild(meshes[1]);
          const left = redOfGreenRunsAcross(await renderFrame(app));
          const kept = numbers.filter((_, i) => i !== 1);
          expect(
            meshes.filter((_, i) => i !== 1).map((mesh) => mesh.meshIndex),
            'a neighbour leaving keeps the others',
          ).toEqual(kept);
          expect(left).toEqual(kept);
          expect(meshes[1].meshIndex, 'a mesh that left the view has no number').toBe(-1);

          view3d.destroy({ children: true });
        } finally {
          app.destroy();
        }
      });
    }

    it("reads each BatchedMesh3D slot's own meshIndex, the same every frame", async () => {
      const app = await getApp({ id: `mesh-index-slots-${preference}`, appOptions });

      try {
        const count = 4;
        const view3d = createView(count);
        app.stage.addChild(view3d);
        const geometry = new CubeGeometry({ width: 0.5, height: 0.5, depth: 0.5 });
        const material = new FlatMaterial({ extraBits: [meshIndexBit] });
        const batched = new BatchedMesh3D({ size: count });
        const matrix = new Matrix4();
        for (let i = 0; i < count; i++) {
          batched.setGeometryAt(i, geometry);
          batched.setMaterialAt(i, material);
          batched.setMatrixAt(i, matrix.makeTranslation(xOf(i, count), 0, 0));
          batched.setPassesAt(i, RenderPassBit.OPAQUE);
        }
        view3d.root.addChild(batched);

        const numbers = batched.items.map((slot) => slot.meshIndex);
        expect(new Set(numbers).size, 'each slot has its own number').toBe(count);

        expect(redOfGreenRunsAcross(await renderFrame(app)), 'the shader reads the number the slot reports').toEqual(
          numbers,
        );

        batched.setVisibleAt(1, false);
        expect(redOfGreenRunsAcross(await renderFrame(app)), 'hiding a slot keeps the others').toEqual(
          numbers.filter((_, i) => i !== 1),
        );
        expect(batched.items.map((slot) => slot.meshIndex)).toEqual(numbers);

        view3d.destroy({ children: true });
      } finally {
        app.destroy();
      }
    });
  });
}
