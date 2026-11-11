import { getApp, readCanvasPixels } from '@test-utils';
import { CanvasSource, Texture } from 'pixi.js';
import type { Application, Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { cpuSubmission } from '~/core/cull';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import type { CullMode } from '~/scene/View3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;
const SLOTS = 48;
const FRAMES = 40;
const EDITS_PER_FRAME = 6;

function lcg(seed: number): (n: number) => number {
  let state = seed >>> 0;
  return (n) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % n;
  };
}

function solidTexture(color: string): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 2, 2);
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

function makeView(app: Application<Renderer>, x: number, cull: CullMode, castShadow = false): View3D {
  const view3d = new View3D({ width: SIZE, height: SIZE, cull });
  view3d.x = x;
  app.stage.addChild(view3d);
  const sun = new DirectionalLight({ intensity: 4, castShadow });
  sun.rotation.set(-0.7, 0.5, 0);
  if (castShadow) {
    sun.shadow.cascades = 2;
    sun.shadow.update = [1, 3];

    const receiver = new Mesh3D({
      geometry: new PlaneGeometry({ width: 30, height: 30 }),
      material: new Material3D({ baseColor: 0xffffff, roughness: 1 }),
      castShadow: false,
    });
    receiver.position.z = -2;
    view3d.root.addChild(receiver);
  }
  view3d.root.addChild(sun);
  view3d.camera.position.set(0, 0, 12);
  return view3d;
}

const TAIL_CASES = [
  { preference: 'webgl', cull: 'off', direct: false },
  { preference: 'webgl', cull: 'cpu', direct: false },
  ...(['off', 'cpu', 'gpu'] as const).flatMap((cull) =>
    [false, true].map((direct) => ({ preference: 'webgpu', cull, direct }) as const),
  ),
] as const;

const OWNED = 8;

const BATCH_SLOTS = 16;

const BURST = 70;

const QUIET_FRAMES = 70;

for (const { preference, cull, direct } of TAIL_CASES) {
  describe(`draw list edits against rebuilds, with shadows and kinds no list has drawn (${preference}, cull ${cull}${direct ? ', direct' : ''})`, () => {
    it('draws new kinds, shadows and batched slots as a rebuilt list draws them, through a burst of 70 kinds and a quiet stretch', async () => {
      const app = await getApp<Renderer>({
        id: `edit-equivalence-tail-${preference}-${cull}-${direct}`,
        appOptions: { preference, width: SIZE * 2, height: SIZE, backgroundColor: 0x000000 },
      });
      cpuSubmission.forward = cpuSubmission.shadow = direct ? Infinity : 0;

      try {
        const edited = makeView(app, 0, cull, true);
        const rebuilt = makeView(app, SIZE, cull, true);
        const views = [edited, rebuilt];
        const geometries = [
          new CubeGeometry({ width: 0.7, height: 0.7, depth: 0.7 }),
          new CubeGeometry({ width: 0.5, height: 0.9, depth: 0.5 }),
          new SphereGeometry({ radius: 0.4 }),
        ];
        const materials = Array.from({ length: 6 }, (_, i) => new Material3D({ baseColor: 0x204080 + i * 0x203010 }));
        const random = lcg(17);
        const present = new Uint8Array(SLOTS);
        const pairs = Array.from({ length: SLOTS }, (_, i) => {
          const geometry = geometries[random(geometries.length)];
          const material = materials[random(materials.length)];
          const make = () => {
            const mesh = new Mesh3D({ geometry, material });
            mesh.position.set((i % 8) * 1.2 - 4.2, Math.floor(i / 8) * 1.2 - 3, 0);
            return mesh;
          };
          return [make(), make()] as const;
        });
        for (let i = 0; i < SLOTS; i++) {
          if (random(3) === 0) continue;
          present[i] = 1;
          edited.root.addChild(pairs[i][0]);
          rebuilt.root.addChild(pairs[i][1]);
        }

        const ownMesh = (j: number, x: number, y: number) => {
          const color = `rgb(${(j * 53) % 256}, ${(j * 97) % 256}, ${(j * 151) % 256})`;
          const mesh = new Mesh3D({
            geometry: geometries[j % geometries.length],
            material: new Material3D({ baseColorTexture: solidTexture(color) }),
          });
          mesh.position.set(x, y, 1.5);
          return mesh;
        };
        let made = 0;
        const owned = Array.from({ length: OWNED }, (_, j) => {
          const meshes = views.map((view3d) => {
            const mesh = ownMesh(made, j * 1.1 - 3.8, 3.6);
            view3d.root.addChild(mesh);
            return mesh;
          });
          made++;
          return meshes;
        });

        const passes = RenderPassBit.OPAQUE | RenderPassBit.SHADOW;
        const slotPresent = new Uint8Array(BATCH_SLOTS).fill(1);
        const batches = views.map((view3d) => {
          const batched = new BatchedMesh3D({ size: BATCH_SLOTS });
          const matrix = new Matrix4();
          for (let j = 0; j < BATCH_SLOTS; j++) {
            batched.setGeometryAt(j, geometries[j % geometries.length]);
            batched.setMaterialAt(j, materials[j % materials.length]);
            batched.setMatrixAt(j, matrix.makeTranslation(j * 0.55 - 4.1, -4, 0.5));
            batched.setPassesAt(j, passes);
          }
          view3d.root.addChild(batched);
          return batched;
        });
        app.render();

        const warmers = views.map((view3d) => {
          const extras = Array.from(
            { length: SLOTS + OWNED + BURST + 8 },
            () => new Mesh3D({ geometry: geometries[0], material: materials[0] }),
          );
          view3d.root.addChild(...extras);
          return extras;
        });
        app.render();
        views.forEach((view3d, v) => view3d.root.removeChild(...warmers[v]));
        app.render();

        const opaque = edited._sceneBatch.drawLists[RenderPassBit.OPAQUE];
        const shadow = edited._sceneBatch.drawLists[RenderPassBit.SHADOW];

        const renderAndCompare = (label: string) => {
          for (const batch of rebuilt._meshBatches) batch.invalidateDrawCaches();
          app.render();
          const left = readCanvasPixels(app.canvas, 0, 0, SIZE, SIZE);
          const right = readCanvasPixels(app.canvas, SIZE, 0, SIZE, SIZE);
          expect(Array.from(left), `${label}: the edited view draws what the rebuilt view draws`).toEqual(
            Array.from(right),
          );
        };
        const tailCommands = () => opaque.commandList.count - opaque.commandList.bodyCount;
        let tailFrames = 0;

        for (let frame = 0; frame < FRAMES; frame++) {
          for (let e = 1 + random(4); e > 0; e--) {
            const i = random(SLOTS);
            const [a, b] = pairs[i];
            const op = random(10);
            if (op <= 1) {
              if (present[i]) {
                edited.root.removeChild(a);
                rebuilt.root.removeChild(b);
              } else {
                edited.root.addChild(a);
                rebuilt.root.addChild(b);
              }
              present[i] ^= 1;
            } else if (op === 2) {
              a.material = b.material = materials[random(materials.length)];
            } else if (op === 3) {
              a.geometry = b.geometry = geometries[random(geometries.length)];
            } else if (op === 4) {
              a.castShadow = b.castShadow = random(2) === 0;
            } else if (op === 5) {
              a.geometry = b.geometry = new CubeGeometry({ width: 0.3 + random(5) * 0.1, height: 0.5, depth: 0.5 });
            } else if (op === 6) {
              const fresh = new Material3D({ baseColor: 0x101010 + random(0xe0e0e0) });
              materials.push(fresh);
              a.material = b.material = fresh;
            } else if (op === 7) {
              const j = random(OWNED);
              const { x, y } = owned[j][0].position;
              owned[j] = views.map((view3d, v) => {
                owned[j][v].destroy({ material: true, texture: true, textureSource: true });
                const mesh = ownMesh(made, x, y);
                view3d.root.addChild(mesh);
                return mesh;
              });
              made++;
            } else if (op === 8) {
              const j = random(BATCH_SLOTS);
              const arm = random(3);
              if (arm === 0) {
                slotPresent[j] ^= 1;
                for (const batched of batches) batched.setPassesAt(j, slotPresent[j] ? passes : 0);
              } else if (arm === 1) {
                const material = materials[random(materials.length)];
                for (const batched of batches) batched.setMaterialAt(j, material);
              } else {
                const visible = random(2) === 0;
                for (const batched of batches) batched.setVisibleAt(j, visible);
              }
            } else {
              a.visible = b.visible = !a.visible;
            }
          }

          renderAndCompare(`frame ${frame}`);
          if (tailCommands() > 0 || shadow.commandList.count > shadow.commandList.bodyCount) tailFrames++;
        }
        expect(tailFrames, 'a quarter of the frames or more drew from a tail').toBeGreaterThanOrEqual(FRAMES / 4);

        const burst = Array.from({ length: BURST }, (_, k) => {
          const x = (k % 14) * 0.6 - 3.9;
          const y = Math.floor(k / 14) * 0.6 - 1.2;
          const meshes = views.map((view3d) => {
            const mesh = ownMesh(made, x, y);
            view3d.root.addChild(mesh);
            return mesh;
          });
          made++;
          return meshes;
        });
        renderAndCompare('burst');

        const lingerer = views.map((view3d) => {
          const mesh = ownMesh(made, 0, -2.4);
          view3d.root.addChild(mesh);
          return mesh;
        });
        made++;
        renderAndCompare('a new kind after the burst');

        for (let frame = 1; frame <= QUIET_FRAMES; frame++) {
          if (frame % 2 === 0) {
            const i = present.indexOf(1, random(SLOTS));
            if (i >= 0) {
              edited.root.removeChild(pairs[i][0]);
              edited.root.addChild(pairs[i][0]);
              rebuilt.root.removeChild(pairs[i][1]);
              rebuilt.root.addChild(pairs[i][1]);
            }
          }
          renderAndCompare(`quiet frame ${frame}`);
        }

        for (const meshes of [...owned, ...burst, lingerer]) {
          for (const mesh of meshes) mesh.destroy({ material: true, texture: true, textureSource: true });
        }
      } finally {
        delete cpuSubmission.forward;
        delete cpuSubmission.shadow;
        app.destroy();
      }
    });
  });
}

for (const preference of ['webgl', 'webgpu'] as const) {
  for (const cull of ['off', 'cpu', 'gpu'] as const) {
    describe(`draw list edits against rebuilds (${preference}, cull ${cull})`, () => {
      it('draws every frame of random edits as a list rebuilt from scratch draws it', async () => {
        const app = await getApp<Renderer>({
          id: `edit-equivalence-${preference}-${cull}`,
          appOptions: { preference, width: SIZE * 2, height: SIZE, backgroundColor: 0x000000 },
        });

        try {
          const edited = makeView(app, 0, cull);
          const rebuilt = makeView(app, SIZE, cull);
          const geometries = [
            new CubeGeometry({ width: 0.7, height: 0.7, depth: 0.7 }),
            new CubeGeometry({ width: 0.5, height: 0.9, depth: 0.5 }),
            new SphereGeometry({ radius: 0.4 }),
          ];
          const materials = [
            ...Array.from({ length: 6 }, (_, i) => new Material3D({ baseColor: 0x204080 + i * 0x203010 })),
            new Material3D({ baseColorTexture: solidTexture('#ff8800') }),
            new Material3D({ baseColorTexture: solidTexture('#22cc66'), roughness: 0.3 }),
          ];

          const random = lcg(preference === 'webgl' ? 11 : 23);
          const geometryOf = new Uint8Array(SLOTS);
          const materialOf = new Uint8Array(SLOTS);
          const present = new Uint8Array(SLOTS);
          const pairs = Array.from({ length: SLOTS }, (_, i) => {
            geometryOf[i] = random(geometries.length);
            materialOf[i] = random(materials.length);
            const make = () => {
              const mesh = new Mesh3D({
                geometry: geometries[geometryOf[i]],
                material: materials[materialOf[i]],
                castShadow: false,
              });
              mesh.position.set((i % 8) * 1.2 - 4.2, Math.floor(i / 8) * 1.2 - 3, 0);
              return mesh;
            };
            return [make(), make()] as const;
          });
          for (let i = 0; i < SLOTS; i++) {
            if (random(4) === 0) continue;
            present[i] = 1;
            edited.root.addChild(pairs[i][0]);
            rebuilt.root.addChild(pairs[i][1]);
          }
          app.render();

          const list = edited._sceneBatch.drawLists[RenderPassBit.OPAQUE];
          let editFrames = 0;

          for (let frame = 0; frame < FRAMES; frame++) {
            for (let e = 0; e < EDITS_PER_FRAME; e++) {
              const i = random(SLOTS);
              const [a, b] = pairs[i];
              const op = random(6);
              if (op === 0 || (op === 1 && present[i])) {
                if (present[i]) {
                  edited.root.removeChild(a);
                  rebuilt.root.removeChild(b);
                } else {
                  edited.root.addChild(a);
                  rebuilt.root.addChild(b);
                }
                present[i] ^= 1;
              } else if (op === 2) {
                materialOf[i] = random(materials.length);
                a.material = b.material = materials[materialOf[i]];
              } else if (op === 3) {
                geometryOf[i] = random(geometries.length);
                a.geometry = b.geometry = geometries[geometryOf[i]];
              } else if (op === 5) {
                a.visible = b.visible = !a.visible;
              } else if (present[i]) {
                edited.root.removeChild(a);
                edited.root.addChild(a);
                rebuilt.root.removeChild(b);
                rebuilt.root.addChild(b);
              }
            }

            const dirtyId = list.commandList.dirtyId;
            rebuilt._sceneBatch.invalidateDrawCaches();
            app.render();
            const left = readCanvasPixels(app.canvas, 0, 0, SIZE, SIZE);
            const right = readCanvasPixels(app.canvas, SIZE, 0, SIZE, SIZE);
            if (list.commandList.dirtyId === dirtyId) editFrames++;

            expect(Array.from(left), `frame ${frame}: the edited view draws what the rebuilt view draws`).toEqual(
              Array.from(right),
            );
          }

          expect(
            editFrames,
            'a quarter of the frames or more edited the list instead of rebuilding it',
          ).toBeGreaterThanOrEqual(FRAMES / 4);
        } finally {
          app.destroy();
        }
      });
    });
  }
}
