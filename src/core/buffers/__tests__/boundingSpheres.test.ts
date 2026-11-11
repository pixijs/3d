import { getApp } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { Mesh3DBatch } from '~/core/batcher/Mesh3DBatch';
import { MESH3D_SPHERE_STRIDE, Mesh3DDataStoreBuffer } from '~/core/buffers/Mesh3DDataStoreBuffer';
import { cpuSubmissionLimit, transformFrustumToBatch } from '~/core/cull';
import type { ForwardRenderPass } from '~/core/render-passes/ForwardRenderPass';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Geometry3D } from '~/geometry/Geometry3D';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { Sphere } from '~/math/shapes/Sphere';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { Container3D } from '~/scene/Container3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 64;

const packed = (store: Mesh3DDataStoreBuffer, row: number): Sphere => {
  const s = store.boundingSpheres as Float32Array;
  const o = row * MESH3D_SPHERE_STRIDE;
  const sphere = new Sphere();
  sphere.center.set(s[o], s[o + 1], s[o + 2]);
  sphere.radius = s[o + 3];
  return sphere;
};

const expectSameSphere = (actual: Sphere, expected: Sphere, label: string) => {
  if (expected.radius < 0) {
    expect(actual.radius, `${label}: no bounds`).toBeLessThan(0);
    return;
  }
  const tolerance = 1e-4 * Math.max(1, expected.radius, Math.abs(expected.center.x), Math.abs(expected.center.z));
  expect(Math.abs(actual.center.x - expected.center.x), `${label}: centre x`).toBeLessThan(tolerance);
  expect(Math.abs(actual.center.y - expected.center.y), `${label}: centre y`).toBeLessThan(tolerance);
  expect(Math.abs(actual.center.z - expected.center.z), `${label}: centre z`).toBeLessThan(tolerance);
  expect(Math.abs(actual.radius - expected.radius), `${label}: radius`).toBeLessThan(tolerance);
};

const morphedGeometry = (): Geometry3D => {
  const source = new CubeGeometry();
  const positions = new Float32Array(source.positions as Float32Array);
  const offsets = new Float32Array(positions.length);
  offsets[1] = 3;
  return new Geometry3D({ positions, indices: source.indices, morphTargets: [{ positions: offsets }] });
};

function survivors(preference: 'webgl' | 'webgpu', view3d: View3D, batch: Mesh3DBatch): Set<number> {
  const list = batch.drawLists[RenderPassBit.OPAQUE];
  const gl = preference === 'webgl';
  const result = gl ? null : (view3d.passByBit[RenderPassBit.OPAQUE] as ForwardRenderPass).cullResults.get(batch)!;
  const drawCalls = gl ? list.drawData.drawCalls : result!.indirectDrawData.drawCalls;
  const texels = gl ? list.glData.indexTexture!.data : result!.survivors.data;
  const kept = new Set<number>();
  for (let k = 0; k < list.commandList.count; k++) {
    const start = drawCalls[k * 5 + 4];
    const count = drawCalls[k * 5 + 1];
    for (let j = 0; j < count; j++) kept.add(texels[start + j]);
  }
  return kept;
}

function expectedSurvivors(
  view3d: View3D,
  batch: Mesh3DBatch,
  rows: { row: number; visible: boolean; sphere: Sphere }[],
): Set<number> {
  const planes = transformFrustumToBatch(view3d.camera.cullFrustum.planesData, batch.storeBuffer.data);
  const kept = new Set<number>();
  for (const { row, visible, sphere } of rows) {
    if (!visible) continue;
    const { x, y, z } = sphere.center;
    let inside = true;
    if (sphere.radius >= 0) {
      for (let p = 0; p < 6; p++) {
        const d = planes[p * 4] * x + planes[p * 4 + 1] * y + planes[p * 4 + 2] * z + planes[p * 4 + 3];
        if (d < -sphere.radius) inside = false;
      }
    }
    if (inside) kept.add(row);
  }
  return kept;
}

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`packed bounding spheres (${preference})`, () => {
    it('match each scene mesh boundingSphere after every kind of move, and the cull keeps the same meshes', async () => {
      const app = await getApp<Renderer>({
        id: `packed-spheres-scene-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE, cull: 'cpu' });
        view3d.camera.position.set(0, 0, 30);
        view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
        app.stage.addChild(view3d);

        const material = new Material3D({ baseColor: 0x808080 });
        const cube = new CubeGeometry();
        const ball = new SphereGeometry({ radius: 2 });
        const dynamic = new CubeGeometry({ dynamic: true });
        const morphed = morphedGeometry();

        const parent = new Container3D();
        view3d.root.addChild(parent);

        const meshes: Mesh3D[] = [];
        for (let i = 0; i < 60; i++) {
          const kind = i % 6;
          const mesh =
            kind === 3
              ? new Mesh3D({ geometry: morphed, material, weights: new Float32Array([0.5]) })
              : new Mesh3D({ geometry: kind === 2 ? dynamic : kind === 1 ? ball : cube, material });
          mesh.position.set(-60 + i * 2, (i % 5) - 2, -(i % 7));
          if (kind === 4) mesh.scale.set(3, 0.5, 1);
          (kind === 5 ? parent : view3d.root).addChild(mesh);
          meshes.push(mesh);
        }

        const store = view3d._sceneBatch.storeBuffer;
        const check = (label: string) => {
          app.render();
          for (const mesh of meshes) {
            expectSameSphere(packed(store, mesh._storeIndex), mesh.boundingSphere, `${label} #${mesh.uid}`);
          }
          const expected = expectedSurvivors(
            view3d,
            view3d._sceneBatch,
            meshes.map((mesh) => ({
              row: mesh._storeIndex,
              visible: mesh.worldVisible !== 0,
              sphere: mesh.boundingSphere,
            })),
          );
          expect(expected.size, `${label}: some meshes in view, some out`).toBeGreaterThan(0);
          expect(expected.size).toBeLessThan(meshes.length);
          expect(survivors(preference, view3d, view3d._sceneBatch), label).toEqual(expected);
        };

        check('first frame');

        for (let i = 0; i < meshes.length; i += 3) meshes[i].position.x += 7;
        meshes[4].rotation.y = 0.7;
        meshes[10].scale.set(5, 1, 1);
        parent.position.set(9, 1, 0);
        parent.rotation.z = 0.4;
        parent.scale.set(2, 2, 2);
        check('moved, rotated, scaled, parent moved');

        meshes[7].geometry = ball;
        meshes[8].geometry = cube;
        meshes[13].visible = false;
        check('geometry swapped and a mesh hidden');

        material.destroy();
      } finally {
        app.destroy();
      }
    });

    it('grows the sphere of a mesh while its geometry has morph targets, and leaves a mesh on another geometry alone', async () => {
      const app = await getApp<Renderer>({
        id: `packed-spheres-morph-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE, cull: 'cpu' });
        app.stage.addChild(view3d);
        const material = new Material3D();
        const geometry = morphedGeometry();
        const cube = new CubeGeometry();
        const store = view3d._sceneBatch.storeBuffer;

        const plain = new Mesh3D({ geometry: cube, material });
        const swapped = new Mesh3D({ geometry: cube, material });
        view3d.root.addChild(plain, swapped);
        app.render();
        const before = packed(store, swapped._storeIndex).radius;

        swapped.geometry = geometry;
        app.render();
        expect(swapped.weights, 'a swapped-in geometry with targets gives the mesh weights').toBeDefined();
        expect(geometry._morphBoundsExpansion).toBeGreaterThan(0);

        expect(
          packed(store, plain._storeIndex).radius,
          'a mesh on a geometry with no targets never deforms',
        ).toBeCloseTo(before, 4);
        expectSameSphere(packed(store, plain._storeIndex), plain.boundingSphere, 'plain getter');
        expect(packed(store, swapped._storeIndex).radius, 'the swapped row carries the packed reach').toBeCloseTo(
          before + geometry._morphBoundsExpansion,
          4,
        );
        expectSameSphere(packed(store, swapped._storeIndex), swapped.boundingSphere, 'swapped getter');

        swapped.geometry = cube;
        app.render();
        expect(swapped.weights, 'a geometry with no targets drops the weights').toBeUndefined();
        expect(packed(store, swapped._storeIndex).radius, 'the reach goes with the weights').toBeCloseTo(before, 4);
        expectSameSphere(packed(store, swapped._storeIndex), swapped.boundingSphere, 'swapped back');
        material.destroy();
      } finally {
        app.destroy();
      }
    });

    it('sweeps each mesh to its getter, growing the morphed ones however they got their weights', async () => {
      const app = await getApp<Renderer>({
        id: `packed-spheres-morph-sweep-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE, cull: 'off' });
        app.stage.addChild(view3d);
        const material = new Material3D();
        const geometry = morphedGeometry();
        const store = view3d._sceneBatch.storeBuffer;

        const plain = new Mesh3D({ geometry: new CubeGeometry(), material });
        const swapped = new Mesh3D({ geometry: new CubeGeometry(), material });
        const morphed = new Mesh3D({ geometry, material, weights: new Float32Array([1]) });
        plain.position.set(2, 0, 0);
        swapped.position.set(-2, 0, 0);
        view3d.root.addChild(plain, swapped, morphed);
        app.render();
        swapped.geometry = geometry;
        app.render();
        expect(swapped.weights, 'a swapped-in geometry with targets gives the mesh weights').toBeDefined();
        expect(geometry._morphBoundsExpansion, 'the morphed meshes packed the targets').toBeGreaterThan(0);
        expect(store.writesSpheres, 'no CPU cull yet').toBe(false);

        view3d.cull = 'cpu';
        app.render();
        expect(store.writesSpheres).toBe(true);
        expect(
          packed(store, plain._storeIndex).radius,
          'a mesh on a geometry with no targets never deforms',
        ).toBeCloseTo(plain.geometry.boundsSphere.radius, 4);
        expectSameSphere(packed(store, plain._storeIndex), plain.boundingSphere, 'swept plain');
        const reach = geometry.boundsSphere.radius + geometry._morphBoundsExpansion;
        expect(packed(store, swapped._storeIndex).radius, 'the swapped row carries the packed reach').toBeCloseTo(
          reach,
          4,
        );
        expectSameSphere(packed(store, swapped._storeIndex), swapped.boundingSphere, 'swept swapped');
        expect(packed(store, morphed._storeIndex).radius, 'the morphed row carries the packed reach').toBeCloseTo(
          reach,
          4,
        );
        expectSameSphere(packed(store, morphed._storeIndex), morphed.boundingSphere, 'swept morphed');
        material.destroy();
      } finally {
        app.destroy();
      }
    });

    it('match each BatchedMesh3D slot under a moving container, and the cull keeps the same slots', async () => {
      const app = await getApp<Renderer>({
        id: `packed-spheres-batch-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE });
        view3d.camera.position.set(0, 0, 30);
        view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
        app.stage.addChild(view3d);

        const material = new Material3D();
        const cube = new CubeGeometry();
        const ball = new SphereGeometry({ radius: 3 });
        const SLOTS = 40;
        const batched = new BatchedMesh3D({ size: SLOTS, cull: 'cpu' });
        const holder = new Container3D();
        holder.addChild(batched);
        view3d.root.addChild(holder);

        const local = new Matrix4();
        const locals: Matrix4[] = [];
        for (let i = 0; i < SLOTS; i++) {
          batched.setGeometryAt(i, i % 4 === 0 ? ball : cube);
          batched.setMaterialAt(i, material);
          batched.setPassesAt(i, RenderPassBit.OPAQUE);
          local.makeTranslation(-40 + i * 2, 0, 0);
          batched.setMatrixAt(i, local);
          locals.push(local.clone());
        }

        const batch = batched.batch;
        const store = batch.storeBuffer;
        const check = (label: string) => {
          app.render();
          const rows = locals.map((matrix, i) => ({
            row: batch.items[i]._storeIndex,
            visible: true,
            sphere: batch.items[i].geometry.boundsSphere.applyMatrix4(matrix, new Sphere()),
          }));
          for (const { row, sphere } of rows) expectSameSphere(packed(store, row), sphere, `${label} row ${row}`);
          for (let i = 0; i < SLOTS; i++) {
            expectSameSphere(batch.items[i].boundingSphere, rows[i].sphere, `${label} slot ${i} getter`);
          }
          const expected = expectedSurvivors(view3d, batch, rows);
          expect(expected.size, `${label}: some slots in view, some out`).toBeGreaterThan(0);
          expect(expected.size).toBeLessThan(SLOTS);
          expect(survivors(preference, view3d, batch), label).toEqual(expected);
        };

        check('first frame');

        holder.position.set(12, 0, 0);
        holder.rotation.y = 0.3;
        check('container moved');

        const { data, stride, offset } = batched.matrices;
        for (let i = 0; i < SLOTS; i += 2) {
          data[offset + i * stride + 12] += 5;
          locals[i].elements[12] += 5;
        }
        batched.matrices.update();
        check('whole-batch write');

        data[offset + 3 * stride + 13] = 4;
        locals[3].elements[13] = 4;
        batched.matrices.update(3, 1);
        local.makeScale(4, 1, 1);
        local.elements[12] = 1;
        batched.setMatrixAt(5, local);
        locals[5] = local.clone();
        batched.setGeometryAt(6, ball);
        check('partial write, slot write, geometry swap');

        material.destroy();
      } finally {
        app.destroy();
      }
    });
  });
}

describe('Mesh3DDataStoreBuffer.boundingSpheres', () => {
  const material = new Material3D();

  const place = (mesh: Mesh3D) => {
    mesh.updateLocalTransform();
    mesh.worldTransform.copyFrom(mesh.localTransform);
  };

  it('allocates nothing until writes turn on, then sizes the spheres to the rows', () => {
    const store = new Mesh3DDataStoreBuffer(4);
    const geometry = new CubeGeometry();
    for (let i = 0; i < 300; i++) {
      const mesh = new Mesh3D({ geometry, material });
      place(mesh);
      store.set(mesh);
    }
    expect(store.writesSpheres).toBe(false);
    expect(store.boundingSpheres, 'growth while off allocates nothing').toBeNull();

    store.enableSphereWrites(true);
    expect(store.boundingSpheres!.length).toBe(Math.floor(store.data.length / 24) * MESH3D_SPHERE_STRIDE);

    store.destroy();
    store.enableSphereWrites(true);
    expect(store.boundingSpheres, 'a destroyed store never allocates').toBeNull();
  });

  it('grows with the rows and keeps every sphere written before', () => {
    const store = new Mesh3DDataStoreBuffer(4);
    store.enableSphereWrites(true);
    const geometry = new CubeGeometry();
    const meshes: Mesh3D[] = [];
    for (let i = 0; i < 300; i++) {
      const mesh = new Mesh3D({ geometry, material });
      mesh.position.set(i, 0, 0);
      place(mesh);
      store.set(mesh);
      meshes.push(mesh);
    }

    expect(store.boundingSpheres!.length).toBe(Math.floor(store.data.length / 24) * MESH3D_SPHERE_STRIDE);
    for (const mesh of meshes) expectSameSphere(packed(store, mesh._storeIndex), mesh.boundingSphere, `#${mesh.uid}`);
    store.destroy();
  });

  it("writes a reused row's sphere for its new owner", () => {
    const store = new Mesh3DDataStoreBuffer(4);
    store.enableSphereWrites(true);
    const big = new Mesh3D({ geometry: new CubeGeometry({ width: 50, height: 50, depth: 50 }), material });
    place(big);
    store.set(big);
    const row = big._storeIndex;
    store.remove(big);

    const dynamic = new Mesh3D({ geometry: new CubeGeometry({ dynamic: true }), material });
    place(dynamic);
    store.set(dynamic);
    expect(dynamic._storeIndex, 'the freed row is reused').toBe(row);
    expect(packed(store, row).radius, 'no bounds, not the last owner sphere').toBeLessThan(0);

    store.remove(dynamic);
    const small = new Mesh3D({ geometry: new CubeGeometry(), material });
    small.position.set(4, 5, 6);
    place(small);
    store.set(small);
    expect(small._storeIndex).toBe(row);
    expectSameSphere(packed(store, row), small.boundingSphere, 'second reuse');
    store.destroy();
  });

  it('keeps the spheres through unload and drops them on destroy', () => {
    const store = new Mesh3DDataStoreBuffer(4);
    store.enableSphereWrites(true);
    const mesh = new Mesh3D({ geometry: new CubeGeometry(), material });
    mesh.position.set(1, 2, 3);
    place(mesh);
    store.set(mesh);

    store.unload();
    store.unload();
    expectSameSphere(packed(store, mesh._storeIndex), mesh.boundingSphere, 'after unload');

    store.destroy();
    store.destroy();
    expect(store.boundingSpheres).toBeNull();
  });
});

describe('bounding sphere gate', () => {
  const cube = new CubeGeometry();
  const ball = new SphereGeometry({ radius: 2 });

  const batchOf = (count: number, cull: 'off' | 'cpu') => {
    const batch = new Mesh3DBatch({ size: count });
    batch.cull = cull;
    const locals: Matrix4[] = [];
    for (let i = 0; i < count; i++) {
      batch.setGeometryAt(i, i % 2 ? ball : cube);
      const local = new Matrix4().makeScale(1 + i, 1, 1);
      local.elements[12] = i * 3;
      batch.setMatrixAt(i, local);
      locals.push(local);
    }
    return { batch, locals };
  };

  const expectedSlot = (batch: Mesh3DBatch, locals: Matrix4[], i: number) =>
    batch.items[i].geometry.boundsSphere.applyMatrix4(locals[i], new Sphere());

  const expectSlotParity = (batch: Mesh3DBatch, locals: Matrix4[], label: string) => {
    for (let i = 0; i < locals.length; i++) {
      const expected = expectedSlot(batch, locals, i);
      expectSameSphere(packed(batch.storeBuffer, batch.items[i]._storeIndex), expected, `${label} packed ${i}`);
      expectSameSphere(batch.items[i].boundingSphere, expected, `${label} getter ${i}`);
    }
  };

  it('writes no spheres for a batch with culling off, and its slots still work out their own', () => {
    const { batch, locals } = batchOf(4, 'off');
    batch.matrices.update();

    expect(batch.storeBuffer.writesSpheres).toBe(false);
    expect(batch.storeBuffer.boundingSpheres, 'never allocated').toBeNull();
    for (let i = 0; i < locals.length; i++) {
      expectSameSphere(batch.items[i].boundingSphere, expectedSlot(batch, locals, i), `getter ${i}`);
    }
    batch.destroy();
  });

  it('is right after turning off, moving every way, and turning on again', () => {
    const { batch, locals } = batchOf(4, 'cpu');
    batch._ensureSpheres();
    expectSlotParity(batch, locals, 'on');

    batch.cull = 'off';
    locals[0].elements[12] = 40;
    batch.setMatrixAt(0, locals[0]);
    const { data, stride, offset } = batch.matrices;
    data[offset + 2 * stride + 13] = -7;
    locals[2].elements[13] = -7;
    batch.matrices.update(2, 1);
    batch.setGeometryAt(3, cube);
    for (let i = 0; i < locals.length; i++) {
      expectSameSphere(batch.items[i].boundingSphere, expectedSlot(batch, locals, i), `off getter ${i}`);
    }

    batch.cull = 'cpu';
    batch._ensureSpheres();
    expectSlotParity(batch, locals, 'on again');
    batch.destroy();
  });

  for (const preference of ['webgl', 'webgpu'] as const) {
    it(`writes for a default view only where a pass culls it on the CPU (${preference})`, async () => {
      const app = await getApp<Renderer>({
        id: `sphere-gate-auto-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE });
        view3d.camera.position.set(0, 0, 60);
        view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
        app.stage.addChild(view3d);
        const material = new Material3D();
        const meshes: Mesh3D[] = [];
        for (let i = 0; i < 400; i++) {
          const mesh = new Mesh3D({ geometry: i % 2 ? ball : cube, material });
          mesh.position.set((i % 40) * 3 - 60, Math.floor(i / 40) * 3 - 15, 0);
          view3d.root.addChild(mesh);
          meshes.push(mesh);
        }
        app.render();
        for (const mesh of meshes) mesh.position.x += 1;
        meshes[3].scale.set(4, 1, 1);
        app.render();

        const store = view3d._sceneBatch.storeBuffer;
        const gl = preference === 'webgl';
        const cpu = gl || cpuSubmissionLimit('forward') >= meshes.length;
        expect(
          store.writesSpheres,
          "WebGL culls 'gpu' on the CPU; WebGPU does too only within the CPU-submission cap",
        ).toBe(cpu);
        expect(store.boundingSpheres === null, 'never allocated while nothing culls on the CPU').toBe(!cpu);
        for (const mesh of meshes) {
          const expected = mesh.geometry.boundsSphere.applyMatrix4(mesh.worldTransform, new Sphere());
          expectSameSphere(mesh.boundingSphere, expected, `getter #${mesh.uid}`);
        }
        for (const mesh of cpu ? meshes : []) {
          const expected = mesh.geometry.boundsSphere.applyMatrix4(mesh.worldTransform, new Sphere());
          expectSameSphere(packed(store, mesh._storeIndex), expected, `packed #${mesh.uid}`);
        }

        const glass = new Material3D({ alphaMode: 'blend', alpha: 0.5 });
        const blended = new Mesh3D({ geometry: cube, material: glass });
        view3d.root.addChild(blended);
        meshes.push(blended);
        app.render();
        expect(store.writesSpheres, 'a back-to-front pass culls on the CPU on either backend').toBe(true);
        for (const mesh of meshes) {
          const expected = mesh.geometry.boundsSphere.applyMatrix4(mesh.worldTransform, new Sphere());
          expectSameSphere(packed(store, mesh._storeIndex), expected, `packed after glass #${mesh.uid}`);
        }
        glass.destroy();
        material.destroy();
      } finally {
        app.destroy();
      }
    });

    it(`sweeps a view's rows on the first frame a pass culls them on the CPU (${preference})`, async () => {
      const app = await getApp<Renderer>({
        id: `sphere-gate-flip-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE, cull: 'off' });
        view3d.camera.position.set(0, 0, 30);
        view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
        app.stage.addChild(view3d);
        const material = new Material3D();
        const big = new CubeGeometry({ width: 30, height: 30, depth: 30 });
        const meshes: Mesh3D[] = [];
        for (let i = 0; i < 30; i++) {
          const mesh = new Mesh3D({ geometry: i === 0 ? big : i % 2 ? ball : cube, material });
          mesh.position.set(-60 + i * 4, 0, 0);
          view3d.root.addChild(mesh);
          meshes.push(mesh);
        }
        app.render();

        const store = view3d._sceneBatch.storeBuffer;
        expect(store.writesSpheres).toBe(false);

        view3d.root.removeChild(meshes[0]);
        const newcomer = new Mesh3D({ geometry: cube, material });
        newcomer.position.set(100, 0, 0);
        view3d.root.addChild(newcomer);
        meshes[0] = newcomer;
        for (const mesh of meshes) mesh.position.y += 2;
        app.render();
        expect(store.boundingSpheres, 'never allocated while off').toBeNull();

        view3d.cull = 'cpu';
        app.render();
        for (const mesh of meshes) {
          expectSameSphere(packed(store, mesh._storeIndex), mesh.boundingSphere, `swept #${mesh.uid}`);
        }

        const expected = expectedSurvivors(
          view3d,
          view3d._sceneBatch,
          meshes.map((mesh) => ({ row: mesh._storeIndex, visible: true, sphere: mesh.boundingSphere })),
        );
        expect(expected.size).toBeGreaterThan(0);
        expect(expected.size).toBeLessThan(meshes.length);
        expect(survivors(preference, view3d, view3d._sceneBatch)).toEqual(expected);
        material.destroy();
      } finally {
        app.destroy();
      }
    });
  }
});
