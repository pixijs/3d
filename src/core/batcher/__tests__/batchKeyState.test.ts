import { getApp } from '@test-utils';
import { Texture, TextureSource } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

import { RenderPassBit } from '../../render-passes/RenderPass';

const build = (material: Material3D, geometry: CubeGeometry, x: number): Mesh3D => {
  const mesh = new Mesh3D({ geometry, material, castShadow: false });
  mesh.position.set(x, 0, 0);

  return mesh;
};

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`batch key with a state-only difference (${preference})`, () => {
    it('breaks the run when two materials differ only in render state', async () => {
      const app = await getApp<Renderer>({
        id: `batch-key-state-${preference}`,
        appOptions: { preference, width: 256, height: 256 },
      });

      try {
        const view3d = new View3D({ width: 256, height: 256, cull: 'off' });
        app.stage.addChild(view3d);
        view3d.camera.position.set(0, 0, 8);

        const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
        const matA = new Material3D({ baseColor: 0xff0000 });
        const matB = new Material3D({ baseColor: 0x00ff00 });
        matB.state.depthTest = false;

        const meshA = build(matA, geometry, -1);
        const meshB = build(matB, geometry, 1);
        view3d.root.addChild(meshA, meshB);

        app.render();

        const bit = RenderPassBit.OPAQUE;
        const cacheA = meshA._passCache[bit];
        const cacheB = meshB._passCache[bit];

        expect(cacheA.shader).toBe(cacheB.shader);
        expect(meshA.geometry).toBe(meshB.geometry);
        expect(matA.state.data).not.toBe(matB.state.data);

        expect(cacheA.batchKey).not.toBe(cacheB.batchKey);

        const pd = view3d._sceneBatch.drawLists[bit];
        expect(pd.commandList.count).toBe(2);

        const states = pd.commandList.commands.slice(0, pd.commandList.count).map((cmd) => cmd.state);
        expect(states.map((state) => state.data).sort((a, b) => a - b)).toEqual(
          [matA.state.data, matB.state.data].sort((a, b) => a - b),
        );
        expect(states, "commands bind their pipeline's copy of the state, never a material's").not.toContain(
          matA.state,
        );
        expect(states).not.toContain(matB.state);
      } finally {
        app.destroy();
      }
    });

    async function shortRun(id: string) {
      const app = await getApp<Renderer>({
        id: `${id}-${preference}`,
        appOptions: { preference, width: 256, height: 256 },
      });
      const view3d = new View3D({ width: 256, height: 256, cull: 'off' });
      app.stage.addChild(view3d);
      view3d.camera.position.set(0, 0, 8);

      const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
      const red = new Material3D({ baseColor: 0xff0000 });
      const green = new Material3D({ baseColor: 0x00ff00 });
      const meshA = build(red, geometry, -2);
      const meshB = build(green, geometry, 0);
      view3d.root.addChild(meshA, meshB, build(red, geometry, 2));
      app.render();

      const bit = RenderPassBit.OPAQUE;
      const pd = view3d._sceneBatch.drawLists[bit];
      const commands = pd.commandList.commands.slice(0, pd.commandList.count);

      return {
        app,
        red,
        green,
        pd,
        commands,
        keyA: meshA._passCache[bit].batchKey,
        keyB: meshB._passCache[bit].batchKey,
      };
    }

    it.runIf(preference === 'webgpu')(
      'draws each material of a short run once, and fuses meshes that share one',
      async () => {
        const { app, red, green, pd, commands, keyA, keyB } = await shortRun('batch-key-state-direct');
        try {
          expect(keyA, 'the batch key says nothing about the material').toBe(keyB);
          expect(commands.length, 'one draw per material').toBe(2);
          const counts = commands.map((_, i) => pd.drawData.drawCalls[i * 5 + 1]).sort((a, b) => a - b);
          expect(counts, 'the two red meshes share a draw').toEqual([1, 2]);
          expect(new Set(commands.map((cmd) => cmd.batchBindGroup)).size, 'each draw binds its own material').toBe(2);
          expect(commands.map((cmd) => cmd.batchBindGroup)).toContain(red._getBindGroup());
          expect(
            commands.map((cmd) => [cmd.batchKey, cmd.merged, cmd.batchBindGroup]),
            "each command records its kind: the batch key and its one material's own group",
          ).toEqual(
            expect.arrayContaining([
              [keyA, false, red._getBindGroup()],
              [keyA, false, green._getBindGroup()],
            ]),
          );
        } finally {
          app.destroy();
        }
      },
    );

    it('the shadow pass binds no material: one draw across both materials, nothing at group 2', async () => {
      const app = await getApp<Renderer>({
        id: `batch-key-state-shadow-${preference}`,
        appOptions: { preference, width: 256, height: 256 },
      });

      try {
        const view3d = new View3D({ width: 256, height: 256, cull: 'off' });
        app.stage.addChild(view3d);
        view3d.camera.position.set(0, 0, 8);
        view3d.root.addChild(new DirectionalLight({ intensity: 4, castShadow: true }));

        const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
        const sources = [0, 1].map(() => new TextureSource({ width: 2, height: 2 }));
        const materials = sources.map((source) => new Material3D({ baseColorTexture: new Texture({ source }) }));
        for (let i = 0; i < 2; i++) {
          const mesh = new Mesh3D({ geometry, material: materials[i], castShadow: true });
          mesh.position.set(i * 2 - 1, 0, 0);
          view3d.root.addChild(mesh);
        }

        app.render();

        const shadow = view3d._sceneBatch.drawLists[RenderPassBit.SHADOW];
        expect(shadow.commandList.count, 'one geometry, one shadow shader: one draw across both materials').toBe(1);
        expect(shadow.commandList.commands[0].batchBindGroup, 'nothing to bind in group 2').toBeUndefined();
        expect(shadow.commandList.commands[0].merged, 'a pass that binds no material draws neither form').toBe(false);

        const opaque = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE];
        expect(opaque.commandList.count, 'the textured pass still draws each material').toBe(2);
      } finally {
        app.destroy();
      }
    });
  });
}
