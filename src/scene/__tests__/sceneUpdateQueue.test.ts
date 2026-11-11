import { expectCleanRender, getApp, readCanvasPixels } from '@test-utils';
import type { Application, Renderer } from 'pixi.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MESH3D_LANE_VISIBILITY, MESH3D_STORE_STRIDE } from '~/core/buffers/Mesh3DDataStoreBuffer';
import { passBitRegistry } from '~/core/render-passes/passBitRegistry';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { OutlinePass } from '~/extras/post-processing/passes/OutlinePass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { Container3D } from '~/scene/Container3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 64;

function staleMeshes(view3d: View3D): string[] {
  const stale: string[] = [];
  for (const mesh of view3d.meshes.items) {
    const inPass = mesh._lastRenderPass !== 0;
    if (mesh.renderPassMask !== mesh._lastRenderPass) stale.push(`${mesh.label}: membership`);
    if (mesh._worldVisible !== mesh._lastWorldVisible) stale.push(`${mesh.label}: visibility`);
    if (inPass && mesh._lastDescriptorDirtyId !== mesh.material._descriptorDirtyId) {
      stale.push(`${mesh.label}: descriptor`);
    }
    if (inPass && mesh._batchDirty) stale.push(`${mesh.label}: batchDirty`);
    if (mesh._storeDirty) stale.push(`${mesh.label}: storeDirty`);
    if (inPass && !mesh.geometry.dynamic && mesh.geometry._geometryAtlasAllocation === null) {
      stale.push(`${mesh.label}: unpacked geometry`);
    }
    if (mesh.didRenderableUpdate) stale.push(`${mesh.label}: still queued`);
  }
  return stale;
}

function build(app: Application<Renderer>) {
  const view3d = new View3D({ width: SIZE, height: SIZE });
  view3d.camera.position.set(0, 0, 4);
  const parent = new Container3D();
  const material = new Material3D({ baseColor: 0xffffff });
  const sphere = new SphereGeometry({ radius: 0.6 });
  const left = new Mesh3D({ geometry: sphere, material, label: 'left', position: { x: -0.8, y: 0, z: 0 } });
  const right = new Mesh3D({ geometry: sphere, material, label: 'right', position: { x: 0.8, y: 0, z: 0 } });
  parent.addChild(left, right);
  view3d.root.addChild(parent);
  app.stage.addChild(view3d);
  return { view3d, parent, material, sphere, left, right };
}

function destroyScene(view3d: View3D): void {
  view3d.destroy({ children: true, geometry: true, material: true });
}

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`scene update queue (${preference})`, () => {
    let app: Application<Renderer>;

    beforeAll(async () => {
      app = await getApp<Renderer>({
        id: `scene-update-queue-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, resolution: 1, backgroundColor: 0x000000 },
      });
    });

    afterAll(() => {
      app.stage.removeChildren();
    });

    async function renderClean(view3d: View3D, what: string): Promise<void> {
      await expectCleanRender(app);
      expect(staleMeshes(view3d), `after ${what}`).toEqual([]);
      expect(view3d._renderablesToUpdate.index, `queue drained after ${what}`).toBe(0);
    }

    async function readFrame(): Promise<Uint8ClampedArray> {
      app.render();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return readCanvasPixels(app.canvas, 0, 0, SIZE, SIZE);
    }

    it('attach lists the mesh on its geometry and material; detach drops it', async () => {
      const { view3d, material, sphere, left, right } = build(app);
      expect(sphere._meshes.items).toEqual([left, right]);
      expect(material._meshes.items).toEqual([left, right]);
      await renderClean(view3d, 'attach');

      left.removeFromParent();
      expect(sphere._meshes.items).toEqual([right]);
      expect(material._meshes.items).toEqual([right]);
      expect(left._geometryMeshIndex).toBe(-1);
      expect(left._materialMeshIndex).toBe(-1);
      expect(left.didRenderableUpdate).toBe(false);
      await renderClean(view3d, 'detach');
      left.destroy();
      destroyScene(view3d);
    });

    it('swapping geometry or material moves the mesh between lists and rebuilds it', async () => {
      const { view3d, material, sphere, left, right } = build(app);
      await renderClean(view3d, 'first frame');

      const cube = new CubeGeometry({ width: 1, height: 1, depth: 1 });
      left.geometry = cube;
      expect(sphere._meshes.items).toEqual([right]);
      expect(cube._meshes.items).toEqual([left]);
      expect(view3d._renderablesToUpdate.index).toBe(1);
      await renderClean(view3d, 'geometry swap');

      const flat = new FlatMaterial({ baseColor: 0xff0000 });
      right.material = flat;
      expect(material._meshes.items).toEqual([left]);
      expect(flat._meshes.items).toEqual([right]);
      await renderClean(view3d, 'material swap');
      destroyScene(view3d);
    });

    it('a shared material change reaches every mesh drawing it, shadows included', async () => {
      const { view3d, material, left, right } = build(app);
      left.castShadow = true;
      right.castShadow = true;
      await renderClean(view3d, 'first frame');
      expect(left._lastRenderPass & RenderPassBit.SHADOW).not.toBe(0);

      material.alphaMode = 'blend';
      expect(view3d._renderablesToUpdate.index).toBe(2);
      await renderClean(view3d, 'alphaMode');
      expect(left._lastRenderPass & RenderPassBit.TRANSPARENT).not.toBe(0);
      expect(left._lastRenderPass & RenderPassBit.SHADOW, 'blended meshes stop casting').toBe(0);
      expect(right._lastRenderPass & RenderPassBit.SHADOW).toBe(0);

      material.alphaMode = 'opaque';
      await renderClean(view3d, 'alphaMode back');
      expect(right._lastRenderPass & RenderPassBit.SHADOW, 'opaque meshes cast again').not.toBe(0);

      material.enablePass('outline');
      await renderClean(view3d, 'enablePass');
      material.disablePass('outline');
      await renderClean(view3d, 'disablePass');
      destroyScene(view3d);
    });

    it('a mesh whose material turned blended before it was added casts no shadow', async () => {
      const { view3d, parent } = build(app);
      await renderClean(view3d, 'first frame');

      const material = new Material3D({ baseColor: 0xffffff });
      const late = new Mesh3D({
        geometry: new SphereGeometry({ radius: 0.3 }),
        material,
        castShadow: true,
        label: 'late',
      });
      material.alphaMode = 'blend';
      parent.addChild(late);
      await renderClean(view3d, 'add blended');
      expect(late._lastRenderPass & RenderPassBit.SHADOW).toBe(0);
      destroyScene(view3d);
    });

    it('a mesh out of the scene when its material changes alphaMode works out its shadow on re-add', async () => {
      const { view3d, parent, material, left } = build(app);
      left.castShadow = true;
      await renderClean(view3d, 'first frame');
      expect(left._lastRenderPass & RenderPassBit.SHADOW).not.toBe(0);

      left.removeFromParent();
      material.alphaMode = 'blend';
      parent.addChild(left);
      await renderClean(view3d, 're-add blended');
      expect(left._lastRenderPass & RenderPassBit.SHADOW, 'blended while out, no shadow back in').toBe(0);

      left.removeFromParent();
      material.alphaMode = 'opaque';
      parent.addChild(left);
      await renderClean(view3d, 're-add opaque');
      expect(left._lastRenderPass & RenderPassBit.SHADOW, 'opaque while out, casting back in').not.toBe(0);
      destroyScene(view3d);
    });

    it('leaving a custom pass touches only that pass, and the outline disappears', async () => {
      const { view3d, material, left, right } = build(app);
      view3d.passes = [new OutlinePass({ width: 0.15, color: 0xff0000 })];
      const outlineBit = passBitRegistry.getOrAllocate('outline');
      await renderClean(view3d, 'first frame');
      const plain = await readFrame();

      material.enablePass('outline');
      await renderClean(view3d, 'enablePass');
      const outlined = await readFrame();
      expect(left._lastRenderPass & outlineBit).not.toBe(0);
      expect(right._lastRenderPass & outlineBit).not.toBe(0);
      expect(outlined, 'the outline draws').not.toEqual(plain);

      const opaque = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE];
      const opaqueDirtyId = opaque.drawDirtyId;
      material.disablePass('outline');
      await renderClean(view3d, 'disablePass');
      expect(left._lastRenderPass & outlineBit).toBe(0);
      expect(right._lastRenderPass & outlineBit).toBe(0);
      expect(opaque.drawDirtyId, 'the opaque pass keeps its draw list').toBe(opaqueDirtyId);
      expect(await readFrame(), 'the outline is gone').toEqual(plain);

      material.enablePass('outline');
      await renderClean(view3d, 'enablePass again');
      expect(await readFrame(), 'the outline is back').toEqual(outlined);
      destroyScene(view3d);
    });

    it('leaving the opaque pass takes the meshes out of it without a rebuild, and joining brings them back', async () => {
      const { view3d, material, left, right } = build(app);
      await renderClean(view3d, 'first frame');
      const opaque = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE];
      expect(opaque.view.count).toBe(2);

      const shadow = view3d._sceneBatch.drawLists[RenderPassBit.SHADOW];
      const shadowDirtyId = shadow.drawDirtyId;
      material.disablePass('opaque');
      await renderClean(view3d, 'disablePass opaque');
      expect(left._lastRenderPass, 'each mesh keeps only its shadow').toBe(RenderPassBit.SHADOW);
      expect(right._lastRenderPass).toBe(RenderPassBit.SHADOW);
      expect(shadow.drawDirtyId, 'the shadow pass keeps its draw list').toBe(shadowDirtyId);
      expect(opaque.view.count, 'the opaque pass is empty').toBe(0);

      left.invalidate();
      await renderClean(view3d, 'rebuild a mesh in no main pass');

      material.enablePass('opaque');
      await renderClean(view3d, 'enablePass opaque');
      expect(opaque.view.count, 'both meshes are back').toBe(2);
      destroyScene(view3d);
    });

    it('a mesh joins and leaves a pass on its own, and its choice beats its material', async () => {
      const { view3d, material, left, right } = build(app);
      view3d.passes = [new OutlinePass({ width: 0.15, color: 0xff0000 })];
      const outlineBit = passBitRegistry.getOrAllocate('outline');
      await renderClean(view3d, 'first frame');

      left.enablePass('outline');
      await renderClean(view3d, 'mesh enablePass');
      const outlines = view3d._sceneBatch.drawLists[outlineBit];
      expect(left._lastRenderPass & outlineBit).not.toBe(0);
      expect(right._lastRenderPass & outlineBit, 'the mesh sharing the material stays out').toBe(0);

      material.enablePass('outline');
      right.disablePass('outline');
      await renderClean(view3d, 'material joins, right opts out');
      expect(right._lastRenderPass & outlineBit, 'the mesh opt-out beats the material').toBe(0);

      material.disablePass('outline');
      await renderClean(view3d, 'material leaves');
      expect(left._lastRenderPass & outlineBit, 'the mesh opt-in beats the material').not.toBe(0);
      expect(outlines.view.count).toBe(1);

      left.disablePass('outline');
      right.enablePass('outline');
      await renderClean(view3d, 'swap which mesh is outlined');
      expect(left._lastRenderPass & outlineBit).toBe(0);
      expect(right._lastRenderPass & outlineBit).not.toBe(0);
      destroyScene(view3d);
    });

    it('a mesh out of the opaque pass still casts its shadow', async () => {
      const { view3d, left, right } = build(app);
      await renderClean(view3d, 'first frame');
      const opaque = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE];

      left.disablePass('opaque');
      await renderClean(view3d, 'mesh leaves opaque');
      expect(left._lastRenderPass).toBe(RenderPassBit.SHADOW);
      expect(right._lastRenderPass & RenderPassBit.OPAQUE).not.toBe(0);
      expect(opaque.view.count).toBe(1);

      left.castShadow = false;
      await renderClean(view3d, 'and stops casting');
      expect(left._lastRenderPass, 'in no pass at all').toBe(0);

      left.castShadow = true;
      left.enablePass('opaque');
      await renderClean(view3d, 'back in both');
      expect(left._lastRenderPass).toBe(RenderPassBit.OPAQUE | RenderPassBit.SHADOW);
      destroyScene(view3d);
    });

    it('unloading a geometry rebuilds every mesh still drawing it', async () => {
      const { view3d, sphere } = build(app);
      await renderClean(view3d, 'first frame');

      sphere.unload();
      expect(sphere._geometryAtlasAllocation).toBeNull();
      expect(view3d._renderablesToUpdate.index).toBe(2);
      await renderClean(view3d, 'geometry unload');
      expect(sphere._geometryAtlasAllocation).not.toBeNull();

      sphere.unload();
      await renderClean(view3d, 'geometry unload after the repack');
      destroyScene(view3d);
    });

    it('unloading a removed subtree rebuilds the meshes still drawing its shared geometry', async () => {
      const { view3d, material, sphere } = build(app);
      const subtree = new Container3D();
      subtree.addChild(new Mesh3D({ geometry: sphere, material, label: 'removed' }));
      view3d.root.addChild(subtree);
      await renderClean(view3d, 'first frame');

      view3d.root.removeChild(subtree);
      subtree.unload();
      sphere.unload();
      await renderClean(view3d, 'subtree unload, then the geometry again');
      expect(sphere._geometryAtlasAllocation).not.toBeNull();
      subtree.destroy({ children: true });
      destroyScene(view3d);
    });

    it('a view off the canvas keeps its queue until it is back on', async () => {
      const { view3d, left } = build(app);
      await renderClean(view3d, 'first frame');

      view3d.x = 10000;
      left.invalidate();
      await expectCleanRender(app);
      expect(view3d._renderablesToUpdate.index, 'an off-canvas view skips its scene update').toBe(1);

      view3d.x = 0;
      await renderClean(view3d, 'back on the canvas');
      destroyScene(view3d);
    });

    it('hiding and showing an ancestor publishes the flip without a membership change', async () => {
      const { view3d, parent, left } = build(app);
      await renderClean(view3d, 'first frame');
      const membership = left._lastRenderPass;

      const store = view3d._sceneBatch.storeBuffer;
      const lane = left._storeIndex * MESH3D_STORE_STRIDE + MESH3D_LANE_VISIBILITY;
      const dirtyId = view3d._sceneBatch._visibilityDirtyId;

      parent.visible = false;
      await renderClean(view3d, 'hide parent');
      expect(left._lastWorldVisible).toBe(0);
      expect(store.u32Data[lane], 'the lane is written in place').toBe(0);
      expect(view3d._sceneBatch._visibilityDirtyId, 'the compaction is woken').toBeGreaterThan(dirtyId);
      expect(left._lastRenderPass).toBe(membership);

      parent.visible = true;
      expect(view3d._renderablesToUpdate.index, 'a flip with a row never queues the mesh').toBe(0);
      await renderClean(view3d, 'show parent');
      expect(left._lastWorldVisible).toBe(1);
      expect(store.u32Data[lane]).toBe(1);
      destroyScene(view3d);
    });

    it('a view-wide shader setting queues every mesh', async () => {
      const { view3d } = build(app);
      await renderClean(view3d, 'first frame');
      view3d.toneMapping = 'aces';
      expect(view3d._renderablesToUpdate.index).toBe(2);
      await renderClean(view3d, 'toneMapping');
      destroyScene(view3d);
    });

    it('a mesh removed and re-added, hidden, comes back with a row', async () => {
      const { view3d, parent, left } = build(app);
      await renderClean(view3d, 'first frame');

      left.removeFromParent();
      await renderClean(view3d, 'remove');
      left.visible = false;
      parent.addChild(left);
      await renderClean(view3d, 're-add hidden');
      expect(left._lastWorldVisible).toBe(0);
      expect(left._storeIndex).toBeGreaterThanOrEqual(0);
      destroyScene(view3d);
    });

    it('a mesh queued in one view and moved to another is drained by the new view', async () => {
      const { view3d, left } = build(app);
      await renderClean(view3d, 'first frame');
      const other = new View3D({ width: SIZE, height: SIZE });
      other.camera.position.set(0, 0, 4);
      app.stage.addChild(other);

      left.invalidate();
      expect(view3d._renderablesToUpdate.index).toBe(1);
      other.root.addChild(left);
      expect(other._renderablesToUpdate.index).toBe(1);
      await renderClean(view3d, 'move away');
      await renderClean(other, 'move in');
      destroyScene(other);
      destroyScene(view3d);
    });

    it('destroying a geometry and material still drawn empties their mesh lists', async () => {
      const { view3d, parent, material, sphere, left, right } = build(app);
      await renderClean(view3d, 'first frame');

      sphere.destroy();
      material.destroy();
      expect(sphere._meshes.items).toEqual([]);
      expect(material._meshes.items).toEqual([]);
      const indices = [left, right].map((mesh) => [mesh._geometryMeshIndex, mesh._materialMeshIndex]);
      expect(indices).toEqual([
        [-1, -1],
        [-1, -1],
      ]);
      expect(() => {
        view3d.root.removeChild(parent);
        left.destroy();
        right.destroy();
      }).not.toThrow();
      view3d.destroy();
    });

    it('destroying a view takes a mesh root off its geometry and material lists', () => {
      const material = new Material3D();
      const sphere = new SphereGeometry();
      const kept = new Mesh3D({ geometry: sphere, material });
      new View3D({ root: kept }).destroy();
      const destroyed = new Mesh3D({ geometry: sphere, material });
      new View3D({ root: destroyed }).destroy({ children: true });
      expect(sphere._meshes.items).toEqual([]);
      expect(material._meshes.items).toEqual([]);
      expect(() => {
        material.alphaMode = 'blend';
      }).not.toThrow();

      const other = new View3D();
      other.root.addChild(kept);
      expect(sphere._meshes.items).toEqual([kept]);
      expect(other._renderablesToUpdate.index).toBe(1);
      expect(other._renderablesToUpdate.list[0]).toBe(kept);
      other.destroy({ children: true });
      sphere.destroy();
      material.destroy();
    });

    it('destroying a mesh root before its view takes it off its geometry and material lists', () => {
      const material = new Material3D();
      const sphere = new SphereGeometry();
      const root = new Mesh3D({ geometry: sphere, material });
      const view3d = new View3D({ root });
      root.destroy();
      expect(() => view3d.destroy()).not.toThrow();
      expect(sphere._meshes.items).toEqual([]);
      expect(material._meshes.items).toEqual([]);
      expect(() => {
        material.alphaMode = 'blend';
      }).not.toThrow();
      sphere.destroy();
      material.destroy();
    });

    it('a churned scene draws the same as one built in its final state', async () => {
      const churned = build(app);
      await expectCleanRender(app);
      churned.material.alphaMode = 'blend';
      await expectCleanRender(app);
      churned.left.visible = false;
      await expectCleanRender(app);
      churned.right.geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
      await expectCleanRender(app);
      churned.left.visible = true;
      churned.material.alphaMode = 'opaque';
      const churnedPixels = await readFrame();
      expect(staleMeshes(churned.view3d)).toEqual([]);
      destroyScene(churned.view3d);

      const fresh = build(app);
      fresh.right.geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
      const freshPixels = await readFrame();
      destroyScene(fresh.view3d);

      expect(churnedPixels).toEqual(freshPixels);
    });
  });
}
