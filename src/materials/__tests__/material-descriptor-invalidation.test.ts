import { getApp, isCI } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;

const makeMesh = (material: Material3D) =>
  new Mesh3D({ geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }), material });

// A material-level change needs per-mesh follow-up work: every mesh sharing the material
// must rebuild its `_passCache`. `_textureCacheKey` cannot carry that signal — it is
// memoised, so the first mesh to re-read it would consume it for its siblings.
// `_descriptorDirtyId` is a monotonic counter each mesh watermarks independently.
describe('material descriptor version', () => {
  it('bumps when alphaMode changes render pass routing', () => {
    const material = new Material3D({ baseColor: 0xffffff });
    const before = material._descriptorDirtyId;

    material.alphaMode = 'blend';

    expect(material._descriptorDirtyId).toBeGreaterThan(before);
    expect(material._passBit).toBe(RenderPassBit.TRANSPARENT);
  });

  it('does not bump on a no-op assignment', () => {
    const material = new Material3D({ baseColor: 0xffffff });

    material.alphaMode = 'blend';
    const settled = material._descriptorDirtyId;

    material.alphaMode = 'blend';

    expect(material._descriptorDirtyId).toBe(settled);
  });

  // Same crash path as alphaMode: joining a custom pass changes `renderPassMask`, so
  // meshes become drawable there before anything populates `_passCache[bit]`.
  it('bumps when a custom pass is enabled at runtime', () => {
    const material = new Material3D({ baseColor: 0xffffff });
    const before = material._descriptorDirtyId;

    material.enablePass('outline-invalidation-test');

    expect(material._descriptorDirtyId).toBeGreaterThan(before);

    // Re-enabling an already-enabled pass changes nothing, so it costs nothing.
    const settled = material._descriptorDirtyId;

    material.enablePass('outline-invalidation-test');
    expect(material._descriptorDirtyId).toBe(settled);
  });

  // Reading the memoised sort key must not consume the dirty signal.
  it('survives the sort key being re-memoised', () => {
    const material = new Material3D({ baseColor: 0xffffff });

    material.alphaMode = 'blend';
    const afterInvalidate = material._descriptorDirtyId;

    expect(material['_textureCacheKey']).toBe(-1);

    // Reading the sort discriminator re-memoises it — the read that would swallow
    // a consumable dirty signal for every mesh after the first.
    void material.textureCacheKey;

    expect(material['_textureCacheKey']).not.toBe(-1);
    expect(material._descriptorDirtyId).toBe(afterInvalidate);
  });
});

// `castShadow` adds/removes the SHADOW bit from `renderPassMask`, which makes the mesh
// drawable in that pass — but only the `_batchDirty` path populates `_passCache[SHADOW]`.
describe('castShadow marks the mesh dirty', () => {
  it('flags a rebuild when the shadow bit actually changes', () => {
    const mesh = makeMesh(new Material3D({ baseColor: 0xffffff }));

    mesh.castShadow = false;
    mesh._batchDirty = false;

    mesh.castShadow = true;

    expect(mesh.renderPassMask & RenderPassBit.SHADOW).toBeTruthy();
    expect(mesh._batchDirty).toBe(true);
  });

  it('stays free when the flip is a no-op', () => {
    const mesh = makeMesh(new Material3D({ baseColor: 0xffffff }));

    mesh.castShadow = true;
    mesh._batchDirty = false;

    mesh.castShadow = true;

    expect(mesh._batchDirty).toBe(false);
  });
});

// Batch slots are driven by a dirty list, not a per-frame scan, so they can't notice a
// material mutating underneath them the way scene meshes do. `invalidate(index)` is the
// escape hatch — it needs to be reachable from the public API, not just `batched.batch`.
describe('BatchedMesh3D.invalidate', () => {
  it('exposes a way to flush a slot after its material mutates', () => {
    const batched = new BatchedMesh3D({ size: 4 });
    const material = new Material3D({ baseColor: 0xffffff });
    const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });

    batched.setGeometryAt(0, geometry);
    batched.setMaterialAt(0, material);

    // Pretend the batch has settled — this is the state a mutation has to break through.
    const slot = batched.items[0];

    slot._batchDirty = false;
    batched.batch._dirtyCount = 0;

    // Mutating the material object announces nothing to the batch...
    material.alphaMode = 'blend';
    expect(slot._batchDirty).toBe(false);

    // ...so the caller announces it.
    batched.invalidate(0);

    expect(slot._batchDirty).toBe(true);
    expect(batched.batch._dirtyCount).toBe(1);

    batched.destroy();
  });
});

// The end-to-end case this all exists for: several meshes sharing ONE material migrate
// between the opaque and transparent passes together. With a consumable signal only the
// first mesh rebuilds and the rest draw from a `_passCache[TRANSPARENT]` that was never
// built — "Cannot read properties of undefined (reading 'shader')" in the batcher.
for (const preference of ['webgpu', 'webgl'] as const) {
  describe.skipIf(isCI)(`shared material pass migration (${preference})`, () => {
    it('rebuilds every mesh sharing the material, not just the first', async () => {
      const app = await getApp<Renderer>({
        id: `descriptor-invalidation-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE });

        app.stage.addChild(view3d);

        // One material, several meshes — the sharing is the whole point.
        const material = new Material3D({ baseColor: 0x4a7c59, metallic: 0, roughness: 0.5 });
        const meshes = [makeMesh(material), makeMesh(material), makeMesh(material)];

        meshes.forEach((mesh, i) => {
          mesh.position.set(i * 2 - 2, 0, 0);
          view3d.root.addChild(mesh);
        });

        view3d.camera.position.set(0, 3, 6);
        view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

        app.render();

        for (const mesh of meshes) {
          expect(mesh._passCache[RenderPassBit.OPAQUE]).toBeDefined();
        }

        // Runtime pass migration — every mesh moves to the transparent pass at once.
        material.alphaMode = 'blend';

        expect(() => app.render()).not.toThrow();

        for (const mesh of meshes) {
          expect(mesh._passCache[RenderPassBit.TRANSPARENT]).toBeDefined();
          expect(mesh._passCache[RenderPassBit.TRANSPARENT].shader).toBeDefined();
        }

        // And back again, so the opaque route is re-established for all of them too.
        material.alphaMode = 'opaque';
        expect(() => app.render()).not.toThrow();
      } finally {
        app.destroy();
      }
    });
  });
}
