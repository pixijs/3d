import { getApp, renderFrame } from '@test-utils';
import { CanvasSource, Matrix, Texture, TextureSource } from 'pixi.js';
import type { Renderer, WebGPURenderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { MERGE_THRESHOLD } from '~/core/batcher/batchConstants';
import type { DrawCommandList } from '~/core/batcher/DrawCommandList';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;

function mergedShaderOf(cache: { shader: unknown; mergedShader: unknown }, preference: 'webgl' | 'webgpu') {
  return preference === 'webgl' ? cache.shader : cache.mergedShader;
}

function commandsOf(list: DrawCommandList) {
  return list.commands.slice(0, list.count);
}

function hueColor(i: number, count: number): number {
  const h = (i / count) * 6;
  const x = Math.round(255 * (1 - Math.abs((h % 2) - 1)));
  const sector = Math.floor(h) % 6;
  const rgb = [
    [255, x, 0],
    [x, 255, 0],
    [0, 255, x],
    [0, x, 255],
    [x, 0, 255],
    [255, 0, x],
  ][sector];

  return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
}

function centreRowColors(pixels: Uint8ClampedArray): number[] {
  const seen: number[] = [];
  let run = 0;
  let last = -1;
  for (let x = 0; x < SIZE; x++) {
    const i = (SIZE / 2) * SIZE * 4 + x * 4;
    const color = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
    run = color === last ? run + 1 : 1;
    last = color;
    if (run === 3 && color !== 0 && !seen.includes(color)) seen.push(color);
  }

  return seen;
}

function closeColors(a: number, b: number, tolerance: number): boolean {
  for (let shift = 0; shift <= 16; shift += 8) {
    if (Math.abs(((a >> shift) & 0xff) - ((b >> shift) & 0xff)) > tolerance) return false;
  }

  return true;
}

function frameRow(view3d: View3D, count: number): void {
  const width = (count * 0.8) / 0.9;
  view3d.camera.position.set(0, 0, width / (2 * Math.tan((view3d.camera.fov * Math.PI) / 360)));
}

function rowX(i: number, count: number): number {
  return (i - (count - 1) / 2) * 0.8;
}

function cubeRow(view3d: View3D, count: number, texture?: Texture, geometry?: CubeGeometry): Mesh3D[] {
  const geom = geometry ?? new CubeGeometry({ width: 0.6, height: 0.6, depth: 0.6 });

  return Array.from({ length: count }, (_, i) => {
    const material = new FlatMaterial({ baseColor: hueColor(i, count), baseColorTexture: texture });
    const mesh = new Mesh3D({ geometry: geom, material, castShadow: false });
    mesh.position.set(rowX(i, count), 0, 0);
    view3d.root.addChild(mesh);

    return mesh;
  });
}

function cellTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4;
  const ctx = canvas.getContext('2d')!;
  for (let c = 0; c < 16; c++) {
    ctx.fillStyle = `#${hueColor(c, 16).toString(16).padStart(6, '0')}`;
    ctx.fillRect(c % 4, c >> 2, 1, 1);
  }

  return new Texture({ source: new CanvasSource({ resource: canvas, scaleMode: 'nearest' }) });
}

function differingPixels(a: Uint8ClampedArray, b: Uint8ClampedArray, tolerance: number): number {
  let count = 0;
  for (let p = 0; p < a.length; p += 4) {
    if (
      Math.abs(a[p] - b[p]) > tolerance ||
      Math.abs(a[p + 1] - b[p + 1]) > tolerance ||
      Math.abs(a[p + 2] - b[p + 2]) > tolerance
    ) {
      count++;
    }
  }

  return count;
}

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`merged runs (${preference})`, () => {
    it('draws a run of more materials than the threshold as one command, with the first material’s merged group and the merged shader', async () => {
      const app = await getApp<Renderer>({
        id: `merged-run-over-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x000000 },
      });

      try {
        const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE, cull: 'off' });
        app.stage.addChild(view3d);
        view3d.camera.position.set(0, 0, 6);

        const count = MERGE_THRESHOLD + 1;
        const meshes = cubeRow(view3d, count);
        frameRow(view3d, count);
        const pixels = await renderFrame(app);

        const bit = RenderPassBit.OPAQUE;
        const list = view3d._sceneBatch.drawLists[bit];
        const commands = commandsOf(list.commandList);
        expect(commands.length).toBe(1);
        expect(list.drawData.drawCalls[1], 'the instance count is the whole run').toBe(count);

        const cmd = commands[0];
        const first = meshes.find((mesh) => mesh.material._getMergedBindGroup() === cmd.batchBindGroup);
        expect(first, 'the command binds one of the run’s merged groups').toBeDefined();
        expect(Object.keys(cmd.batchBindGroup!.resources).length, 'textures and samplers only, no row').toBe(
          first!.material._textures.length * 2,
        );

        const cache = meshes[0]._passCache[bit];
        expect(mergedShaderOf(cache, preference), 'compiled on first use').not.toBeNull();
        expect(cmd.shader).toBe(mergedShaderOf(cache, preference));
        expect(cmd.shader === cache.shader, 'WebGL draws its pass shader, WebGPU a second one').toBe(
          preference === 'webgl',
        );

        const drawn = centreRowColors(pixels);
        expect(drawn.length, 'every instance read its own material row').toBe(count);
        for (let i = 0; i < count; i++) {
          expect(
            drawn.some((color) => closeColors(color, hueColor(i, count), 8)),
            `material ${i}'s colour reached the canvas`,
          ).toBe(true);
        }
      } finally {
        app.destroy();
      }
    });

    it.runIf(preference === 'webgpu')(
      'draws a run of threshold-many materials as a command per material, and never compiles a merged shader',
      async () => {
        const app = await getApp<Renderer>({
          id: `merged-run-at-${preference}`,
          appOptions: { preference, width: SIZE, height: SIZE },
        });

        try {
          const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE, cull: 'off' });
          app.stage.addChild(view3d);
          view3d.camera.position.set(0, 0, 6);
          const ensureMergedShader = vi.spyOn((app.renderer as WebGPURenderer).material3d, 'ensureMergedShader');

          const count = MERGE_THRESHOLD;
          const meshes = cubeRow(view3d, count);
          app.render();

          const bit = RenderPassBit.OPAQUE;
          const list = view3d._sceneBatch.drawLists[bit];
          const commands = commandsOf(list.commandList);
          expect(commands.length).toBe(count);
          for (const cmd of commands) {
            expect(meshes.some((mesh) => mesh.material._getBindGroup() === cmd.batchBindGroup)).toBe(true);
            expect(cmd.shader).toBe(meshes[0]._passCache[bit].shader);
          }
          expect(ensureMergedShader).not.toHaveBeenCalled();
          expect(meshes[0]._passCache[bit].mergedShader).toBeNull();
        } finally {
          app.destroy();
        }
      },
    );

    it.runIf(preference === 'webgpu')(
      'turns from a command per material to one command when the run grows past the threshold',
      async () => {
        const app = await getApp<Renderer>({
          id: `merged-run-boundary-${preference}`,
          appOptions: { preference, width: SIZE, height: SIZE },
        });

        try {
          const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE, cull: 'off' });
          app.stage.addChild(view3d);
          view3d.camera.position.set(0, 0, 6);

          const geometry = new CubeGeometry({ width: 0.6, height: 0.6, depth: 0.6 });
          cubeRow(view3d, MERGE_THRESHOLD, undefined, geometry);
          app.render();

          const list = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE];
          expect(list.commandList.count, 'exactly the threshold: direct').toBe(MERGE_THRESHOLD);

          const extra = new Mesh3D({
            geometry,
            material: new FlatMaterial({ baseColor: 0xffffff }),
            castShadow: false,
          });
          extra.position.set(0, 1, 0);
          view3d.root.addChild(extra);
          app.render();
          view3d._sceneBatch.invalidateDrawCaches();
          app.render();

          expect(list.commandList.count, 'one past the threshold: merged').toBe(1);
          expect(list.drawData.drawCalls[1]).toBe(MERGE_THRESHOLD + 1);

          view3d.root.removeChild(extra);
          app.render();
          expect(list.commandList.count, 'a removal keeps the merged command, edited').toBe(1);
          expect(list.drawData.drawCalls[1]).toBe(MERGE_THRESHOLD);

          view3d._sceneBatch.invalidateDrawCaches();
          app.render();
          expect(list.commandList.count, 'back at the threshold, a rebuild draws direct again').toBe(MERGE_THRESHOLD);
        } finally {
          app.destroy();
        }
      },
    );

    it('merges a run that starts with many rows of one material and then meets more materials than the threshold', async () => {
      const app = await getApp<Renderer>({
        id: `merged-run-long-head-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x000000 },
      });

      try {
        const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE, cull: 'off' });
        app.stage.addChild(view3d);

        const geometry = new CubeGeometry({ width: 0.6, height: 0.6, depth: 0.6 });
        const tail = MERGE_THRESHOLD + 1;
        const slots = tail + 1;
        const headRows = 50;

        const headMaterial = new FlatMaterial({ baseColor: hueColor(0, slots) });
        const tailMaterials = Array.from(
          { length: tail },
          (_, i) => new FlatMaterial({ baseColor: hueColor(i + 1, slots) }),
        );
        for (let i = 0; i < headRows; i++) {
          const mesh = new Mesh3D({ geometry, material: headMaterial, castShadow: false });
          mesh.position.set(rowX(0, slots), 0, 0);
          view3d.root.addChild(mesh);
        }
        tailMaterials.forEach((material, i) => {
          const mesh = new Mesh3D({ geometry, material, castShadow: false });
          mesh.position.set(rowX(i + 1, slots), 0, 0);
          view3d.root.addChild(mesh);
        });
        frameRow(view3d, slots);
        const pixels = await renderFrame(app);

        const bit = RenderPassBit.OPAQUE;
        const list = view3d._sceneBatch.drawLists[bit];
        const commands = commandsOf(list.commandList);
        expect(commands.length, 'one merged command for the whole run').toBe(1);
        expect(list.drawData.drawCalls[1], 'the instance count is every row of the run').toBe(headRows + tail);
        expect(list.drawData.drawCalls[4], 'the run starts at the first row').toBe(0);
        expect(commands[0].batchBindGroup, 'the run’s first material owns the group').toBe(
          headMaterial._getMergedBindGroup(),
        );
        const firstRow = list.view.items[list.view.indices[0]];
        expect(firstRow.material, 'a head row sorts first').toBe(headMaterial);
        expect(commands[0].shader).toBe(mergedShaderOf(firstRow._passCache[bit], preference));

        const drawn = centreRowColors(pixels);
        expect(drawn.length, 'the head and every tail material reached the canvas').toBe(slots);
        for (let i = 0; i < slots; i++) {
          expect(closeColors(drawn[i], hueColor(i, slots), 8), `slot ${i} drew its own material's colour`).toBe(true);
        }
      } finally {
        app.destroy();
      }
    });

    it.runIf(preference === 'webgpu')(
      'keeps no rewound command: the list holds the other runs’ commands and the one merged command',
      async () => {
        const app = await getApp<Renderer>({
          id: `merged-run-rewind-${preference}`,
          appOptions: { preference, width: SIZE, height: SIZE },
        });

        try {
          const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE, cull: 'off' });
          app.stage.addChild(view3d);
          view3d.camera.position.set(0, 0, 6);

          const geometries = [0, 1, 2].map(() => new CubeGeometry({ width: 0.6, height: 0.6, depth: 0.6 }));
          const before = cubeRow(view3d, 2, undefined, geometries[0]);
          const mergedRun = cubeRow(view3d, MERGE_THRESHOLD + 1, undefined, geometries[1]);
          const after = cubeRow(view3d, 2, undefined, geometries[2]);
          for (const mesh of [...before, ...after]) mesh.position.y = 1;
          app.render();

          const bit = RenderPassBit.OPAQUE;
          const list = view3d._sceneBatch.drawLists[bit];
          const commands = commandsOf(list.commandList);
          const drawCalls = list.drawData.drawCalls;
          expect(commands.length, 'two direct, one merged, two direct').toBe(5);

          const total = before.length + mergedRun.length + after.length;
          let next = 0;
          for (let c = 0; c < commands.length; c++) {
            expect(drawCalls[c * 5 + 4], `command ${c} starts where the one before ended`).toBe(next);
            next += drawCalls[c * 5 + 1];
          }
          expect(next, 'the commands cover every row once').toBe(total);

          const direct = [before[0], before[1], null, after[0], after[1]];
          for (let c = 0; c < commands.length; c++) {
            const mesh = direct[c];
            if (!mesh) continue;
            expect(commands[c].batchBindGroup, `command ${c} binds its own material`).toBe(
              mesh.material._getBindGroup(),
            );
            expect(commands[c].shader).toBe(mesh._passCache[bit].shader);
          }
          expect(commands[2].batchBindGroup).toBe(mergedRun[0].material._getMergedBindGroup());
          expect(commands[2].shader).toBe(mergedShaderOf(mergedRun[0]._passCache[bit], preference));
          expect(drawCalls[2 * 5 + 1]).toBe(mergedRun.length);
        } finally {
          app.destroy();
        }
      },
    );

    it('splits one geometry’s run at a texture-set change, even when both halves are over the threshold', async () => {
      const app = await getApp<Renderer>({
        id: `merged-run-texture-sets-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE, cull: 'off' });
        app.stage.addChild(view3d);
        view3d.camera.position.set(0, 0, 6);

        const geometry = new CubeGeometry({ width: 0.6, height: 0.6, depth: 0.6 });
        const textures = [0, 1].map(() => new Texture({ source: new TextureSource({ width: 2, height: 2 }) }));
        const count = MERGE_THRESHOLD + 1;
        const runs = textures.map((texture) => cubeRow(view3d, count, texture, geometry));
        app.render();

        const list = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE];
        const commands = commandsOf(list.commandList);
        expect(commands.length, 'one merged command per texture set').toBe(2);
        const groups = commands.map((cmd) => cmd.batchBindGroup);
        for (let s = 0; s < 2; s++) {
          const drawn = groups.filter((group) => runs[s].some((mesh) => mesh.material._getMergedBindGroup() === group));
          expect(drawn.length, `set ${s} draws once, with one of its own materials' merged groups`).toBe(1);
          expect(drawn[0]!.getResource(runs[s][0].material._slotByName.baseColor * 2)).toBe(textures[s].source);
        }
        expect([list.drawData.drawCalls[1], list.drawData.drawCalls[6]]).toEqual([count, count]);
      } finally {
        app.destroy();
      }
    });

    it('splits a merged run when one material’s texture swaps source, and rejoins it on the swap back', async () => {
      const app = await getApp<Renderer>({
        id: `merged-run-texture-swap-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE, cull: 'off' });
        app.stage.addChild(view3d);
        view3d.camera.position.set(0, 0, 6);

        const [shared, other] = [0, 1].map(() => new Texture({ source: new TextureSource({ width: 2, height: 2 }) }));
        const count = MERGE_THRESHOLD + 2;
        const meshes = cubeRow(view3d, count, shared);
        const swapped = meshes[count - 1].material;
        const slot = swapped._slotByName.baseColor * 2;
        app.render();
        const list = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE];
        expect(list.commandList.count, 'one texture set: one merged command').toBe(1);

        swapped.textures.baseColor = other;
        app.render();
        const commands = commandsOf(list.commandList);
        expect(commands.length, 'the swapped material leaves the run').toBe(2);
        const own = commands.findIndex((cmd) => cmd.batchBindGroup!.getResource(slot) === other.source);
        expect(own, 'one command binds the new source').not.toBe(-1);
        expect(list.drawData.drawCalls[own * 5 + 1], 'and draws only the swapped mesh').toBe(1);
        expect(commands[1 - own].batchBindGroup!.getResource(slot), 'the rest keep the shared source').toBe(
          shared.source,
        );
        expect(list.drawData.drawCalls[(1 - own) * 5 + 1]).toBe(count - 1);

        swapped.textures.baseColor = shared;
        app.render();
        expect(list.commandList.count, 'the swap back rejoins the run').toBe(1);
        expect(list.drawData.drawCalls[1]).toBe(count);

        view3d.destroy({ children: true, geometry: true, material: true });
        shared.destroy(true);
        other.destroy(true);
      } finally {
        app.destroy();
      }
    });

    it.runIf(preference === 'webgpu')(
      'merges a distance-sorted run of two materials once their changes need more commands than the threshold',
      async () => {
        const app = await getApp<Renderer>({
          id: `merged-run-alternating-${preference}`,
          appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x000000 },
        });

        try {
          const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE, cull: 'off' });
          app.stage.addChild(view3d);
          view3d.camera.position.set(0, 0, 10);

          const geometry = new CubeGeometry({ width: 0.4, height: 0.4, depth: 0.4 });
          const materials = [0xff0000, 0x0000ff].map(
            (baseColor) => new FlatMaterial({ baseColor, alphaMode: 'blend' }),
          );
          const addRow = (i: number) => {
            const mesh = new Mesh3D({ geometry, material: materials[i % 2], castShadow: false });
            mesh.position.set((i - MERGE_THRESHOLD / 2) * 0.5, 0, -i * 0.6);
            view3d.root.addChild(mesh);
          };
          for (let i = 0; i < MERGE_THRESHOLD; i++) addRow(i);
          app.render();

          const list = view3d._sceneBatch.drawLists[RenderPassBit.TRANSPARENT];
          let commands = commandsOf(list.commandList);
          expect(commands.length, 'threshold-many changes: a command per change, no merge').toBe(MERGE_THRESHOLD);
          expect(commands.every((cmd) => materials.some((m) => m._getBindGroup() === cmd.batchBindGroup))).toBe(true);

          addRow(MERGE_THRESHOLD);
          app.render();

          commands = commandsOf(list.commandList);
          expect(commands.length, 'one change more: the two materials draw as one merged command').toBe(1);
          expect(materials.some((m) => m._getMergedBindGroup() === commands[0].batchBindGroup)).toBe(true);
        } finally {
          app.destroy();
        }
      },
    );

    it.runIf(preference === 'webgl')(
      'draws every run of a material pass merged from its first row, a lone material included',
      async () => {
        const app = await getApp<Renderer>({
          id: `merged-run-webgl-always-${preference}`,
          appOptions: { preference, width: SIZE, height: SIZE },
        });

        try {
          const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE, cull: 'off' });
          app.stage.addChild(view3d);
          view3d.camera.position.set(0, 0, 6);

          const bit = RenderPassBit.OPAQUE;
          const meshes = cubeRow(view3d, 3);
          app.render();

          const list = view3d._sceneBatch.drawLists[bit];
          let commands = commandsOf(list.commandList);
          expect(commands.length, 'three materials on one geometry: one command').toBe(1);
          expect(commands[0].batchBindGroup).toBe(meshes[0].material._getMergedBindGroup());
          expect(commands[0].shader).toBe(meshes[0]._passCache[bit].shader);

          for (const mesh of meshes.slice(1)) mesh.removeFromParent();
          app.render();

          commands = commandsOf(list.commandList);
          expect(commands.length, 'a lone material draws merged too').toBe(1);
          expect(commands[0].batchBindGroup).toBe(meshes[0].material._getMergedBindGroup());
          expect(commands[0].shader).toBe(meshes[0]._passCache[bit].shader);
        } finally {
          app.destroy();
        }
      },
    );

    it.runIf(preference === 'webgl')(
      'draws a distance-sorted run of two blended materials as one command, back to front, each in its own colour',
      async () => {
        const app = await getApp<Renderer>({
          id: `merged-run-webgl-blend-${preference}`,
          appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x000000 },
        });

        try {
          const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE, cull: 'off' });
          app.stage.addChild(view3d);
          view3d.camera.position.set(0, 0, 6);

          const geometry = new CubeGeometry({ width: 0.6, height: 0.6, depth: 0.6 });
          const materials = [0xff0000, 0x0000ff].map(
            (baseColor) => new FlatMaterial({ baseColor, alpha: 0.5, alphaMode: 'blend' }),
          );
          const addRow = (i: number) => {
            const mesh = new Mesh3D({ geometry, material: materials[i % 2], castShadow: false });
            mesh.position.z = i * 0.6;
            view3d.root.addChild(mesh);
          };
          for (let i = 3; i >= 0; i--) addRow(i);
          const pixels = await renderFrame(app);

          const list = view3d._sceneBatch.drawLists[RenderPassBit.TRANSPARENT];
          const commands = commandsOf(list.commandList);
          expect(commands.length, 'three material changes on one geometry: one command').toBe(1);
          expect(list.drawData.drawCalls[1], 'the instance count is every row').toBe(4);
          expect(materials.some((m) => m._getMergedBindGroup() === commands[0].batchBindGroup)).toBe(true);

          const backToFront = 0x50009f;
          const centre = ((SIZE / 2) * SIZE + SIZE / 2) * 4;
          const drawn = (pixels[centre] << 16) | (pixels[centre + 1] << 8) | pixels[centre + 2];
          expect(
            closeColors(drawn, backToFront, 8),
            `centre drew 0x${drawn.toString(16)}; back to front is 0x50009f, front to back 0x9f0050`,
          ).toBe(true);
        } finally {
          app.destroy();
        }
      },
    );

    it('binds nothing and never asks for a merged shader in the shadow pass, whatever the run length', async () => {
      const app = await getApp<Renderer>({
        id: `merged-run-shadow-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE, cull: 'off' });
        app.stage.addChild(view3d);
        view3d.camera.position.set(0, 0, 6);
        view3d.root.addChild(new DirectionalLight({ intensity: 4, castShadow: true }));

        const geometry = new CubeGeometry({ width: 0.6, height: 0.6, depth: 0.6 });
        const count = MERGE_THRESHOLD + 1;
        const meshes = Array.from({ length: count }, (_, i) => {
          const material = new Material3D({ baseColor: hueColor(i, count) });
          const mesh = new Mesh3D({ geometry, material, castShadow: true });
          mesh.position.set((i - (count - 1) / 2) * 0.8, 0, 0);
          view3d.root.addChild(mesh);

          return mesh;
        });
        const ensureMergedShader =
          preference === 'webgpu' ? vi.spyOn((app.renderer as WebGPURenderer).material3d, 'ensureMergedShader') : null;
        app.render();

        const shadow = view3d._sceneBatch.drawLists[RenderPassBit.SHADOW];
        expect(shadow.commandList.count, 'one geometry, one shadow shader: one draw').toBe(1);
        expect(shadow.commandList.commands[0].batchBindGroup).toBeUndefined();
        expect(meshes[0]._passCache[RenderPassBit.SHADOW].mergedShader).toBeNull();

        const opaque = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE];
        expect(opaque.commandList.count, 'the material pass merges the same run').toBe(1);
        expect(
          ensureMergedShader?.mock.calls.length ?? 0,
          'merged shaders asked for: once on WebGPU, by the material pass; WebGL has none to ask for',
        ).toBe(preference === 'webgpu' ? 1 : 0);
      } finally {
        app.destroy();
      }
    });

    it.runIf(preference === 'webgpu')(
      'draws a merged run of lit, textured materials as the same materials drawn direct',
      async () => {
        const app = await getApp<Renderer>({
          id: `merged-run-equals-direct-${preference}`,
          appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x000000 },
        });

        try {
          const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE, cull: 'off' });
          app.stage.addChild(view3d);
          view3d.camera.position.set(0, 0, 4);
          const light = new DirectionalLight({ intensity: 3 });
          light.rotation.set(-0.6, 0.5, 0);
          view3d.root.addChild(light);

          const texture = cellTexture();
          const geometry = new SphereGeometry({ radius: 0.35 });
          const count = MERGE_THRESHOLD + 1;
          const side = Math.ceil(Math.sqrt(MERGE_THRESHOLD));
          const meshes = Array.from({ length: count }, (_, i) => {
            const material = new Material3D({
              baseColorTexture: texture,
              baseColor: hueColor(i, count),
              metallic: (i % 4) / 3,
              roughness: 0.2 + (i >> 2) * 0.2,
              emissive: { color: hueColor(count - 1 - i, count), strength: 0.2 },
              uvTransform: new Matrix().translate(i / 16, 0),
            });
            const mesh = new Mesh3D({ geometry, material, castShadow: false });
            mesh.position.set(((i % side) - (side - 1) / 2) * 0.9, (Math.floor(i / side) - (side - 1) / 2) * 0.9, 0);
            view3d.root.addChild(mesh);

            return mesh;
          });
          const extra = meshes[MERGE_THRESHOLD];
          extra.position.set(0, 0, 20);

          app.render();
          const merged = await renderFrame(app);
          const list = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE];
          expect(list.commandList.count, 'one past the threshold: merged').toBe(1);

          view3d.root.removeChild(extra);
          view3d._sceneBatch.invalidateDrawCaches();
          const direct = await renderFrame(app);
          expect(list.commandList.count, 'at the threshold: a command per material').toBe(MERGE_THRESHOLD);

          const black = new Uint8ClampedArray(direct.length);
          expect(differingPixels(direct, black, 0), 'the spheres drew').toBeGreaterThan((SIZE * SIZE) / 8);
          const bound = { tolerance: 2, fewerThan: (SIZE * SIZE) / 256 };
          expect(
            differingPixels(merged, direct, bound.tolerance),
            `pixels more than ${bound.tolerance} apart; WebGPU's compiler treats the uniform read and the texel-loaded read differently`,
          ).toBeLessThan(bound.fewerThan);
        } finally {
          app.destroy();
        }
      },
    );

    it('shows a material edit inside a merged run on the next frame', async () => {
      const app = await getApp<Renderer>({
        id: `merged-run-edit-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x000000 },
      });

      try {
        const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE, cull: 'off' });
        app.stage.addChild(view3d);

        const count = MERGE_THRESHOLD + 1;
        const meshes = cubeRow(view3d, count);
        frameRow(view3d, count);
        await renderFrame(app);

        const edited = count >> 1;
        (meshes[edited].material as FlatMaterial).baseColor = 0xffffff;
        const drawn = centreRowColors(await renderFrame(app));

        expect(view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE].commandList.count, 'still merged').toBe(1);
        expect(drawn.length).toBe(count);
        expect(closeColors(drawn[edited], 0xffffff, 8), 'the edited material drew its new colour').toBe(true);
        expect(closeColors(drawn[edited - 1], hueColor(edited - 1, count), 8), 'its neighbour kept its own').toBe(true);
      } finally {
        app.destroy();
      }
    });
  });
}
