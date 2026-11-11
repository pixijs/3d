import { expectCleanRender, getApp, renderFrame } from '@test-utils';
import { CanvasSource, Texture } from 'pixi.js';
import type { Application, Buffer, Renderer, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { DrawCommandCapture } from '~/core/batcher/DrawCommandCapture';
import type { DrawCommandList } from '~/core/batcher/DrawCommandList';
import type { DrawList } from '~/core/render-passes/DrawList';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

async function threeKinds(id: string, preference: 'webgl' | 'webgpu') {
  const app = await getApp<Renderer>({
    id: `${id}-${preference}`,
    appOptions: { preference, width: 128, height: 128, backgroundColor: 0x000000 },
  });
  const view3d = new View3D({ width: 128, height: 128, cull: 'off' });
  app.stage.addChild(view3d);
  const sun = new DirectionalLight({ intensity: 4, castShadow: true });
  sun.rotation.set(-Math.PI / 4, Math.PI / 5, 0);
  view3d.root.addChild(sun);
  view3d.camera.position.set(0, 0, 9);

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

function stranger(geometry: Geometry3D, color = 0x00ff00): Mesh3D {
  const mesh = new Mesh3D({
    geometry,
    material: new Material3D({ baseColor: color, baseColorTexture: canvasTexture() }),
  });
  mesh.position.set(((color >> 4) % 7) * 0.5 - 1.5, -2, 0);
  return mesh;
}

function sharing(geometry: Geometry3D, texture: Texture, x: number): Mesh3D {
  const mesh = new Mesh3D({ geometry, material: new Material3D({ baseColor: 0xffffff, baseColorTexture: texture }) });
  mesh.position.set(x, -2, 0);
  return mesh;
}

function onBuffersOf(body: Geometry3D): Geometry3D {
  return new Geometry3D({
    attributes: body.attributes,
    indices: body.indexBuffer,
    dynamic: true,
    bounds3D: body.bounds3D,
  });
}

function sourceOf(mesh: Mesh3D): TextureSource {
  return mesh.material.textures.baseColor!.source;
}

function captures(commandList: DrawCommandList): Map<unknown, DrawCommandCapture> {
  return (commandList as unknown as { _captures: Map<unknown, DrawCommandCapture> })._captures;
}

function drawLists(view3d: View3D): DrawList[] {
  return Object.values(view3d._sceneBatch.drawLists);
}

function watchers(lists: DrawList[], resource: TextureSource | Buffer, event: 'change' | 'styleChange'): number {
  const heard = (resource as unknown as { listeners(name: string): unknown[] }).listeners(event);
  let count = 0;
  for (const list of lists) {
    const listener = (list.commandList as unknown as { _onCaptureResourceLost: unknown })._onCaptureResourceLost;
    for (const fn of heard) if (fn === listener) count++;
  }
  return count;
}

function textureWatchers(lists: DrawList[], source: TextureSource): number[] {
  return [watchers(lists, source, 'change'), watchers(lists, source, 'styleChange')];
}

function backdate(source: TextureSource): number {
  source._gcLastUsed = 1;
  return source._gcLastUsed;
}

function buildIntoBody(app: Application<Renderer>, view3d: View3D, bodyMesh: Mesh3D): void {
  view3d.root.addChild(bodyMesh);
  app.render();
  view3d._sceneBatch.invalidateDrawCaches();
  app.render();
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
  view3d._sceneBatch.invalidateDrawCaches();
  expect(Array.from(edited), 'the edited list draws what a rebuild draws').toEqual(Array.from(await renderFrame(app)));
}

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`tail capture lifetime (${preference})`, () => {
    it('keeps only the live tail members captured through sustained churn', async () => {
      const { app, view3d, meshes, list } = await threeKinds('tail-capture-churn', preference);
      const visitors = Array.from({ length: 120 }, (_, i) => stranger(meshes[0].geometry, i + 1));
      try {
        view3d.root.addChild(...visitors);
        app.render();
        view3d.root.removeChild(...visitors);
        app.render();
        const lists = drawLists(view3d);
        const initialCaptures = captures(list.commandList).size;

        let current: Mesh3D[] = [];
        let next = 0;
        for (let frame = 0; frame < 80; frame++) {
          if (current.length) view3d.root.removeChild(...current);
          const size = frame % 2 === 0 ? 1 : 2;
          current = visitors.slice(next, next + size);
          next += size;
          view3d.root.addChild(...current);
          app.render();
        }

        expect(captures(list.commandList).size - initialCaptures, "only the live visitors' textures").toBe(2);
        for (const visitor of visitors) {
          const expected = current.includes(visitor) ? 1 : 0;
          expect(textureWatchers(lists, sourceOf(visitor)), `visitor ${visitor.uid}`).toEqual([expected, expected]);
        }
      } finally {
        app.destroy();
        for (const mesh of visitors) mesh.destroy({ material: true, texture: true });
      }
    });

    it("releases a departed tail member's texture in the call that removes it, and stops stamping it", async () => {
      const { app, view3d, meshes, list } = await threeKinds('tail-capture-departed', preference);
      const resident = stranger(meshes[2].geometry, 0x0000ff);
      const visitor = stranger(meshes[0].geometry, 0x00ff00);
      try {
        buildIntoBody(app, view3d, resident);
        const lists = drawLists(view3d);

        view3d.root.addChild(visitor);
        app.render();
        expect(captures(list.commandList).has(sourceOf(visitor)), 'the tail command captured it').toBe(true);
        expect(textureWatchers(lists, sourceOf(visitor))).toEqual([1, 1]);

        view3d.root.removeChild(visitor);
        expect(captures(list.commandList).has(sourceOf(visitor)), 'released before any render').toBe(false);
        expect(textureWatchers(lists, sourceOf(visitor))).toEqual([0, 0]);

        app.render();

        const departedStamp = backdate(sourceOf(visitor));
        const residentStamp = backdate(sourceOf(resident));
        app.render();
        app.render();
        expect(sourceOf(visitor)._gcLastUsed, 'nothing stamps a texture nothing draws').toBe(departedStamp);
        expect(sourceOf(resident)._gcLastUsed, "the body's texture is stamped as drawn").toBeGreaterThan(residentStamp);
      } finally {
        app.destroy();
        visitor.destroy({ material: true, texture: true });
      }
    });

    it('destroys a tail-only mesh with its material and texture source', async () => {
      const { app, view3d, meshes } = await threeKinds('tail-capture-destroy', preference);
      const resident = stranger(meshes[2].geometry, 0x0000ff);
      try {
        buildIntoBody(app, view3d, resident);
        const visitor = stranger(meshes[0].geometry, 0x00ff00);
        view3d.root.addChild(visitor);
        app.render();

        const visitorSource = sourceOf(visitor);
        visitor.destroy({ material: true, texture: true, textureSource: true });
        expect(visitorSource.destroyed, 'the texture source went with the mesh').toBe(true);
        await expectSameAsRebuild(app, view3d, await renderFrame(app));

        const residentSource = sourceOf(resident);
        resident.destroy({ material: true, texture: true, textureSource: true });
        expect(residentSource.destroyed).toBe(true);
        await expectSameAsRebuild(app, view3d, await renderFrame(app));
      } finally {
        app.destroy();
      }
    });

    it('keeps a shared texture captured, on one listener, until no command that binds it is left', async () => {
      const { app, view3d, meshes, list } = await threeKinds('tail-capture-shared', preference);
      const resident = stranger(meshes[2].geometry, 0x0000ff);
      const texture = canvasTexture('#33ccff');
      try {
        buildIntoBody(app, view3d, resident);
        const lists = drawLists(view3d);
        const bodyTexture = sourceOf(resident);
        expect(textureWatchers(lists, bodyTexture)).toEqual([1, 1]);

        const sharer = sharing(meshes[0].geometry, resident.material.textures.baseColor!, 0);
        view3d.root.addChild(sharer);
        app.render();
        expect(textureWatchers(lists, bodyTexture), 'one listener for body and tail together').toEqual([1, 1]);

        view3d.root.removeChild(sharer);
        expect(captures(list.commandList).has(bodyTexture), 'the body still draws it').toBe(true);
        expect(textureWatchers(lists, bodyTexture)).toEqual([1, 1]);
        app.render();

        bodyTexture.unload();
        await expectCleanRender(app);
        await expectSameAsRebuild(app, view3d, await renderFrame(app));

        const first = sharing(meshes[0].geometry, texture, -1);
        const second = sharing(meshes[4].geometry, texture, 1);
        view3d.root.addChild(first, second);
        app.render();
        expect(textureWatchers(lists, texture.source)).toEqual([1, 1]);

        view3d.root.removeChild(first);
        expect(captures(list.commandList).has(texture.source), 'the other tail command holds it').toBe(true);
        expect(textureWatchers(lists, texture.source)).toEqual([1, 1]);
        app.render();

        view3d.root.removeChild(second);
        expect(captures(list.commandList).has(texture.source), 'released with the last command binding it').toBe(false);
        expect(textureWatchers(lists, texture.source)).toEqual([0, 0]);
        await expectSameAsRebuild(app, view3d, await renderFrame(app));
      } finally {
        app.destroy();
        resident.destroy({ material: true, texture: true });
        texture.destroy(true);
      }
    });

    it('leaves no listener on tail or body textures after an unload or a destroy, and draws again after the unload', async () => {
      const { app, view3d, meshes, list } = await threeKinds('tail-capture-teardown', preference);
      const resident = stranger(meshes[2].geometry, 0x0000ff);
      const visitor = stranger(meshes[0].geometry, 0x00ff00);
      const latecomer = stranger(meshes[4].geometry, 0xff00ff);
      try {
        buildIntoBody(app, view3d, resident);
        view3d.root.addChild(visitor);
        app.render();
        const lists = drawLists(view3d);
        const sources = [sourceOf(resident), sourceOf(visitor)];
        for (const source of sources) expect(textureWatchers(lists, source)).toEqual([1, 1]);

        view3d.unload();
        for (const source of sources) {
          expect(textureWatchers(lists, source), 'unload releases every capture').toEqual([0, 0]);
        }

        const redrawn = await renderFrame(app);
        expect(list.commandList.count, 'the next render rebuilds').toBeGreaterThan(0);
        await expectSameAsRebuild(app, view3d, redrawn);
        for (const source of sources) expect(textureWatchers(lists, source)).toEqual([1, 1]);

        view3d.root.addChild(latecomer);
        app.render();
        sources.push(sourceOf(latecomer));
        expect(textureWatchers(lists, sourceOf(latecomer))).toEqual([1, 1]);

        view3d.destroy();
        for (const source of sources) {
          expect(textureWatchers(lists, source), 'destroy releases every capture').toEqual([0, 0]);
        }
      } finally {
        app.destroy();
        for (const mesh of [resident, visitor, latecomer]) mesh.destroy({ material: true, texture: true });
      }
    });

    it("captures and releases a tail-only dynamic geometry's buffers with its member", async () => {
      const { app, view3d, list } = await threeKinds('tail-capture-dynamic', preference);
      const geometry = new CubeGeometry({ width: 0.4, height: 0.4, depth: 0.4, dynamic: true });
      const mesh = new Mesh3D({ geometry, material: new Material3D({ baseColor: 0x00ffff }) });
      mesh.position.set(0, -2, 0);
      try {
        const lists = drawLists(view3d);
        const shadow = view3d._sceneBatch.drawLists[RenderPassBit.SHADOW];

        view3d.root.addChild(mesh);
        app.render();
        expect(geometry.buffers.length).toBeGreaterThan(0);
        for (const buffer of geometry.buffers) {
          expect(captures(list.commandList).has(buffer), 'the opaque tail command captured its buffers').toBe(true);
          expect(captures(shadow.commandList).has(buffer), 'and the shadow one').toBe(true);
          expect(watchers(lists, buffer, 'change'), 'one listener per list').toBe(2);
        }

        view3d.root.removeChild(mesh);
        app.render();
        for (const buffer of geometry.buffers) {
          expect(captures(list.commandList).has(buffer)).toBe(false);
          expect(captures(shadow.commandList).has(buffer)).toBe(false);
          expect(watchers(lists, buffer, 'change'), 'no list listens to it any more').toBe(0);
        }
      } finally {
        app.destroy();
        mesh.destroy({ geometry: true, material: true });
      }
    });

    it('keeps a texture its material took after the body was built captured, while a tail command draws it', async () => {
      const { app, view3d, meshes, list } = await threeKinds('tail-capture-swap', preference);
      const material = new Material3D({ baseColor: 0xffffff, baseColorTexture: canvasTexture() });
      const texture = canvasTexture('#33ccff');
      try {
        meshes[4].material = material;
        meshes[5].material = material;
        app.render();
        view3d._sceneBatch.invalidateDrawCaches();
        app.render();
        view3d.root.removeChild(meshes[4], meshes[5]);
        app.render();

        material.textures.baseColor = texture;
        const mesh = new Mesh3D({ geometry: meshes[4].geometry, material });
        mesh.position.copyFrom(meshes[4].position);
        view3d.root.addChild(mesh);
        app.render();
        expect(captures(list.commandList).has(texture.source), 'the tail command captured the new texture').toBe(true);

        texture.source.unload();
        await expectCleanRender(app);
        await expectSameAsRebuild(app, view3d, await renderFrame(app));
      } finally {
        app.destroy();
        texture.destroy(true);
      }
    });

    it("forgets a departed tail member's geometry on a buffer the body still holds", async () => {
      const { app, view3d, list } = await threeKinds('tail-capture-shared-buffer', preference);
      const body = new CubeGeometry({ width: 0.4, height: 0.4, depth: 0.4, dynamic: true });
      const material = new Material3D({ baseColor: 0x00ffff });
      const bodyMesh = new Mesh3D({ geometry: body, material });
      bodyMesh.position.set(0, -2, 0);
      try {
        buildIntoBody(app, view3d, bodyMesh);

        for (let round = 0; round < 100; round++) {
          const geometry = onBuffersOf(body);
          const mesh = new Mesh3D({ geometry, material });
          mesh.position.set(1, -2, 0);
          view3d.root.addChild(mesh);
          app.render();
          view3d.root.removeChild(mesh);
          app.render();
          mesh.destroy();
          geometry.destroy();
        }

        expect(
          captures(list.commandList)
            .get(body.buffers[0])
            ?.geometries?.map(({ uid }) => uid),
          "only the body's geometry is left",
        ).toEqual([body.uid]);
      } finally {
        app.destroy();
        bodyMesh.destroy({ geometry: true, material: true });
      }
    });

    it('keeps a geometry on a shared capture while another tail member still draws it', async () => {
      const { app, view3d, list } = await threeKinds('tail-capture-shared-geometry', preference);
      const geometry = new CubeGeometry({ width: 0.4, height: 0.4, depth: 0.4, dynamic: true });
      const first = stranger(geometry, 0x00ff00);
      const second = stranger(geometry, 0x0000ff);
      try {
        view3d.root.addChild(first, second);
        app.render();
        const buffer = geometry.buffers[0];

        view3d.root.removeChild(first);
        app.render();
        expect(
          captures(list.commandList)
            .get(buffer)
            ?.geometries?.map(({ uid }) => uid),
          'the second member still draws it',
        ).toEqual([geometry.uid]);

        view3d.root.removeChild(second);
        app.render();
        expect(captures(list.commandList).has(buffer), 'released with the last member').toBe(false);
      } finally {
        app.destroy();
        for (const mesh of [first, second]) mesh.destroy({ material: true, texture: true });
        geometry.destroy();
      }
    });
  });
}
