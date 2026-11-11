import { getApp, readCanvasPixels, renderFrame } from '@test-utils';
import { CanvasSource, Texture } from 'pixi.js';
import type { Application, Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { DrawList } from '~/core/render-passes/DrawList';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import type { Geometry3D } from '~/geometry/Geometry3D';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { MeshPass } from '~/post-processing/passes/MeshPass';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { Camera3D } from '~/scene/cameras/Camera3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;

function lcg(seed: number): (n: number) => number {
  let state = seed >>> 0;
  return (n) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % n;
  };
}

function makeView(app: Application<Renderer>, x = 0): View3D {
  const view3d = new View3D({ width: SIZE, height: SIZE, cull: 'off' });
  view3d.x = x;
  app.stage.addChild(view3d);
  const sun = new DirectionalLight({ intensity: 4, castShadow: true });
  sun.rotation.set(-Math.PI / 4, Math.PI / 5, 0);
  view3d.root.addChild(sun);
  view3d.camera.position.set(0, 0, 9);
  return view3d;
}

async function threeKinds(id: string, preference: 'webgl' | 'webgpu') {
  const app = await getApp<Renderer>({
    id: `${id}-${preference}`,
    appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x000000 },
  });
  const view3d = makeView(app);

  const material = new Material3D({ baseColor: 0xff8800, roughness: 0.5 });
  let geometries: CubeGeometry[];
  do {
    geometries = [0.6, 0.8, 1].map((size) => new CubeGeometry({ width: size, height: size, depth: size }));
  } while ((geometries[0].uid & 0xff) > (geometries[2].uid & 0xff));
  const meshes = geometries.flatMap((geometry, g) =>
    [0, 1].map((i) => {
      const mesh = new Mesh3D({ geometry, material });
      mesh.position.set(g * 2 - 2, i * 2 - 1, 0);
      return mesh;
    }),
  );
  view3d.root.addChild(...meshes);
  app.render();

  const list = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE];
  expect(list.commandList.count, 'one command per geometry').toBe(3);

  return { app, view3d, meshes, list };
}

function canvasTexture(color = '#ff8800'): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2;
  const context = canvas.getContext('2d')!;
  context.fillStyle = color;
  context.fillRect(0, 0, 2, 2);
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

function tailCommands(list: DrawList): number {
  return list.commandList.count - list.commandList.bodyCount;
}

function stranger(geometry: Geometry3D, color = 0x00ff00): Mesh3D {
  const mesh = new Mesh3D({
    geometry,
    material: new Material3D({ baseColor: color, baseColorTexture: canvasTexture() }),
  });
  mesh.position.set(((color >> 4) % 7) * 0.5 - 1.5, -2, 0);
  return mesh;
}

function twin(like: Mesh3D, x: number, y: number): Mesh3D {
  const mesh = new Mesh3D({ geometry: like.geometry, material: like.material });
  mesh.position.set(x, y, 0.5);
  return mesh;
}

async function expectSameAsRebuild(
  app: Application<Renderer>,
  view3d: View3D,
  edited: Uint8ClampedArray,
): Promise<void> {
  expect(
    edited.some((channel, i) => i % 4 !== 3 && channel > 0),
    'the frame draws something',
  ).toBe(true);
  for (const batch of view3d._meshBatches) batch.invalidateDrawCaches();
  expect(Array.from(edited), 'the edited list draws what a rebuild draws').toEqual(Array.from(await renderFrame(app)));
}

function expectViewsMatch(app: Application<Renderer>, label: string): void {
  const left = readCanvasPixels(app.canvas, 0, 0, SIZE, SIZE);
  const right = readCanvasPixels(app.canvas, SIZE, 0, SIZE, SIZE);
  expect(Array.from(left), label).toEqual(Array.from(right));
}

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`draw list membership (${preference})`, () => {
    it('keeps its uid maps bounded by the live meshes through 2,000 replacements', async () => {
      const { app, view3d, meshes, list } = await threeKinds('membership-bounded', preference);
      try {
        const shadow = view3d._sceneBatch.drawLists[RenderPassBit.SHADOW];
        let current = meshes[5];
        const replace = () => {
          view3d.root.removeChild(current);
          if (current !== meshes[5]) current.destroy();
          current = twin(meshes[4], 0, 1);
          view3d.root.addChild(current);
        };

        for (let i = 1; i < 2000; i++) {
          replace();
          app.render();
        }
        replace();
        const edited = await renderFrame(app);

        for (const drawList of [list, shadow]) {
          const uids = (drawList.view as unknown as { _uidToLocal: Map<number, number> })._uidToLocal;
          expect(uids.size, "the view's uid map holds the live members only").toBe(drawList.view.count);
        }
        const slots = (view3d._meshSlots as unknown as { _uidToIndex: Map<number, number> })._uidToIndex;
        expect(slots.size, "the view's mesh slots hold the live members only").toBe(meshes.length);
        await expectSameAsRebuild(app, view3d, edited);
      } finally {
        app.destroy();
      }
    });

    it('drops the queue of a list no pass draws once it outgrows the batch, and rebuilds it when drawn again', async () => {
      const app = await getApp<Renderer>({
        id: `membership-queue-bound-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x000000 },
      });
      try {
        const view3d = new View3D({ width: SIZE, height: SIZE, cull: 'off' });
        view3d.camera.position.set(0, 0, 9);
        view3d.root.addChild(new DirectionalLight({ intensity: 4 }));
        app.stage.addChild(view3d);
        const batch = new BatchedMesh3D({ size: 8 });
        const geometry = new CubeGeometry({ width: 0.5, height: 0.5, depth: 0.5 });
        const material = new Material3D({ baseColor: 0x62b9dc });
        const matrix = new Matrix4();
        for (let i = 0; i < batch.size; i++) {
          batch.setGeometryAt(i, geometry);
          batch.setMaterialAt(i, material);
          matrix.fromArray([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, (i % 4) - 1.5, Math.floor(i / 4) - 0.5, 0, 1]);
          batch.setMatrixAt(i, matrix);
          batch.setPassesAt(i, RenderPassBit.OPAQUE);
        }
        view3d.root.addChild(batch);
        app.render();
        app.render();
        const list = batch.batch.drawLists[RenderPassBit.OPAQUE];

        app.stage.removeChild(view3d);
        for (let i = 0; i < 1000; i++) {
          batch.setPassesAt(i % batch.size, 0);
          batch.setPassesAt(i % batch.size, RenderPassBit.OPAQUE);
        }

        expect(
          (list as unknown as { _joining: Uint32Array })._joining.length,
          'the queue stays near its first size',
        ).toBeLessThanOrEqual(64);

        app.stage.addChild(view3d);
        const edited = await renderFrame(app);
        await expectSameAsRebuild(app, view3d, edited);
      } finally {
        app.destroy();
      }
    });

    it('keeps drawing a tail mesh from every camera on the frame the tail folds', async () => {
      const { app, view3d, meshes, list } = await threeKinds('membership-fold-cameras', preference);
      const joined = stranger(meshes[0].geometry, 0x00ff00);
      try {
        app.stop();
        const inset = new Camera3D();
        inset.position.set(0, 0, 9);
        inset.viewport.set(0.75, 0, 0.25, 0.25);
        view3d.root.addChild(inset);
        view3d.passes = [new MeshPass({ name: 'opaque', camera: inset })];
        app.render();

        view3d.root.addChild(joined);
        await renderFrame(app);
        const baseline = Array.from(await renderFrame(app));

        for (let frame = 3; frame <= 72; frame++) {
          const drawn = Array.from(await renderFrame(app));
          const changed = drawn.findIndex((channel, i) => channel !== baseline[i]);
          expect(changed, `frame ${frame}, counting the join's as 1, changes the picture`).toBe(-1);
        }
        expect(tailCommands(list), 'the tail folded inside the 70 frames').toBe(0);
      } finally {
        app.destroy();
        joined.destroy({ material: true, texture: true });
      }
    });

    it('draws a new caster in a throttled cascade that skipped the frames of its edits', async () => {
      const app = await getApp<Renderer>({
        id: `membership-shadow-throttled-${preference}`,
        appOptions: { preference, width: SIZE * 2, height: SIZE, backgroundColor: 0x000000 },
      });
      try {
        const views = [makeView(app), makeView(app, SIZE)];
        const geometry = new CubeGeometry({ width: 0.8, height: 0.8, depth: 0.8 });
        const floor = new CubeGeometry({ width: 8, height: 0.2, depth: 8 });
        const dynamic = new CubeGeometry({ width: 0.6, height: 0.6, depth: 0.6, dynamic: true });
        const material = new Material3D({ baseColor: 0xffffff });
        const texture = canvasTexture('#ffcc00');
        for (const view3d of views) {
          const sun = view3d.root.children.find(
            (child): child is DirectionalLight => child instanceof DirectionalLight,
          )!;
          sun.shadow.cascades = 2;
          sun.shadow.update = [1, 3];
          view3d.camera.position.set(0, 3, 9);
          view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
          const ground = new Mesh3D({ geometry: floor, material });
          ground.position.set(0, -1.5, 0);
          const cubes = [-2, 0, 2].map((x) => {
            const cube = new Mesh3D({ geometry, material });
            cube.position.set(x, 0, -1);
            return cube;
          });
          view3d.root.addChild(ground, ...cubes);
        }
        app.render();
        app.render();
        const rebuilt = views[1];

        for (let frame = 0; frame < 7; frame++) {
          if (frame === 1) {
            for (const view3d of views) {
              const caster = new Mesh3D({ geometry, material: new Material3D({ baseColorTexture: texture }) });
              caster.position.set(-1, 1, 1.5);
              view3d.root.addChild(caster);
            }
          } else if (frame === 2) {
            for (const view3d of views) {
              const caster = new Mesh3D({ geometry: dynamic, material });
              caster.position.set(1, 1, 1.5);
              view3d.root.addChild(caster);
            }
          }
          rebuilt._sceneBatch.invalidateDrawCaches();
          app.render();
          expectViewsMatch(app, `frame ${frame}: the edited view draws what the rebuilt view draws`);
        }
      } finally {
        app.destroy();
      }
    });

    it('edits a batched mesh whose slots leave and rejoin by the dozen every frame, as a rebuilt twin draws it', async () => {
      const app = await getApp<Renderer>({
        id: `membership-batched-${preference}`,
        appOptions: { preference, width: SIZE * 2, height: SIZE, backgroundColor: 0x000000 },
      });
      try {
        const geometries = [
          new CubeGeometry({ width: 0.5, height: 0.5, depth: 0.5 }),
          new CubeGeometry({ width: 0.3, height: 0.7, depth: 0.3 }),
          new SphereGeometry({ radius: 0.3 }),
        ];
        const materials = [0xff4040, 0x40ff40, 0x4040ff].map((baseColor) => new Material3D({ baseColor }));
        const SLOTS = 40;
        const passes = RenderPassBit.OPAQUE | RenderPassBit.SHADOW;
        const random = lcg(29);
        const kindOf = Array.from({ length: SLOTS }, (_, i) => (i < 9 ? i : random(9)));
        const views = [makeView(app), makeView(app, SIZE)];
        const batches = views.map((view3d) => {
          const batched = new BatchedMesh3D({ size: SLOTS });
          const matrix = new Matrix4();
          for (let i = 0; i < SLOTS; i++) {
            batched.setGeometryAt(i, geometries[kindOf[i] % 3]);
            batched.setMaterialAt(i, materials[Math.floor(kindOf[i] / 3)]);
            batched.setMatrixAt(i, matrix.makeTranslation((i % 8) * 0.8 - 2.8, Math.floor(i / 8) * 0.8 - 1.6, 0));
            batched.setPassesAt(i, passes);
          }
          view3d.root.addChild(batched);
          return batched;
        });
        app.render();
        const rebuilt = batches[1];
        const present = new Uint8Array(SLOTS).fill(1);

        for (let frame = 0; frame < 30; frame++) {
          for (let e = 0; e < 12; e++) {
            const i = 9 + random(SLOTS - 9);
            present[i] ^= 1;
            for (const batched of batches) batched.setPassesAt(i, present[i] ? passes : 0);
          }
          rebuilt.batch.invalidateDrawCaches();
          app.render();
          expectViewsMatch(app, `frame ${frame}: the edited batch draws what the rebuilt batch draws`);
        }
      } finally {
        app.destroy();
      }
    });
  });
}
