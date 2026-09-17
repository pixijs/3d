import { getApp } from '@test-utils';
import { CanvasSource, Texture } from 'pixi.js';
import type { Application, WebGLRenderer, WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;

/** The renderers that carry a `view3d` pipe (and so the three renderer-scoped stores) */
type Gpu3DRenderer = WebGLRenderer | WebGPURenderer;

function makeTexture(color: string): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 4, 4);

  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

/** A camera-facing quad with one morph target that widens it; weight 0 draws the base pose. */
function morphedQuad(): Geometry3D {
  return new Geometry3D({
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    morphTargets: [{ positions: new Float32Array([-1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0]) }],
  });
}

/** The user-owned objects that survive a renderer: one material, one geometry, one morphed mesh, shared by meshes */
interface Survivors {
  material: Material3D;
  texture: Texture;
  geometry: CubeGeometry;
  morphed: Geometry3D;
  morphedMesh: Mesh3D;
  nodes: (Mesh3D | DirectionalLight)[];
}

function buildSurvivors(): Survivors {
  const texture = makeTexture('#ff8800');
  const material = new Material3D({ baseColorTexture: texture, metallic: 0, roughness: 0.5 });
  const geometry = new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 });

  const left = new Mesh3D({ geometry, material });
  left.position.set(-1.6, 0, 0);
  const right = new Mesh3D({ geometry, material });
  right.position.set(1.6, 0, 0);

  const morphed = morphedQuad();
  const morphedMesh = new Mesh3D({ geometry: morphed, material, weights: new Float32Array([0]) });
  morphedMesh.position.set(0, 0, -2);

  const sun = new DirectionalLight({ color: 0xfff4e0, intensity: 4 });
  sun.rotation.set((-55 * Math.PI) / 180, (55 * Math.PI) / 180, 0);

  return { material, texture, geometry, morphed, morphedMesh, nodes: [left, right, morphedMesh, sun] };
}

/** Shows the survivors in a fresh View on `app` (reparenting them out of any previous View) and renders once. */
function show(app: Application<Gpu3DRenderer>, survivors: Survivors): View3D {
  const view3d = new View3D({ width: SIZE, height: SIZE });
  app.stage.addChild(view3d);
  view3d.root.addChild(...survivors.nodes);
  view3d.camera.position.set(0, 4, 9);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  app.render();

  return view3d;
}

function pixels(app: Application<Gpu3DRenderer>, view3d: View3D): Uint8Array {
  return new Uint8Array(app.renderer.extract.pixels(view3d).pixels);
}

/** Count pixels whose colour differs by more than `tol` on any channel. */
function differingPixels(a: Uint8Array, b: Uint8Array, tol = 8): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > tol || Math.abs(a[i + 1] - b[i + 1]) > tol || Math.abs(a[i + 2] - b[i + 2]) > tol) {
      n++;
    }
  }
  return n;
}

/** Renders one frame, returning the WebGPU validation error it raised (always `null` on WebGL). */
async function renderCatchingValidationErrors(app: Application<Gpu3DRenderer>): Promise<GPUError | null> {
  const device = 'gpu' in app.renderer ? app.renderer.gpu.device : null;
  if (!device) {
    app.render();
    return null;
  }

  device.pushErrorScope('validation');
  app.render();
  return device.popErrorScope();
}

// The material, geometry and morph stores are renderer-scoped; the objects
// they row are user-owned and outlive them. Nothing unwires a survivor when
// its renderer dies: it carries the dead store until the next renderer's store
// sees it, and re-mints there.
for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`store re-adoption (${preference})`, () => {
    const appOptions = { preference, width: SIZE, height: SIZE, backgroundColor: 0x101018 };

    it('survivors of a destroyed renderer re-mint in the next renderer and draw the same frame', async () => {
      const survivors = buildSurvivors();
      const { material, geometry, morphed, morphedMesh } = survivors;

      const appA = await getApp<Gpu3DRenderer>({ id: `store-readoption-a-${preference}`, appOptions });
      const viewA = show(appA, survivors);
      const before = pixels(appA, viewA);

      const pipeA = appA.renderer.renderPipes.view3d;
      expect(material._uploadQueue).toBe(pipeA.materialStoreBuffer);
      expect(geometry._geometryDataStore).toBe(pipeA.geometryDataStoreBuffer);
      expect(morphed._morphStore).toBe(pipeA._morphStoreBuffer);
      expect(morphedMesh.morph!._store).toBe(pipeA._morphStoreBuffer);

      // The View and everything in it survive, still wired to the dead stores.
      appA.destroy();

      // A late signal through the stale back-reference is inert.
      material.update();
      expect(material._storeQueued).toBe(false);
      // Handing the geometry's own buffers back between renderers is fine: B re-uploads them.
      expect(() => geometry.unload()).not.toThrow();

      const appB = await getApp<Gpu3DRenderer>({ id: `store-readoption-b-${preference}`, appOptions });
      try {
        const viewB = new View3D({ width: SIZE, height: SIZE });
        appB.stage.addChild(viewB);
        viewB.root.addChild(...survivors.nodes);
        viewB.camera.position.set(0, 4, 9);
        viewB.camera.lookAt({ x: 0, y: 0, z: 0 });

        const error = await renderCatchingValidationErrors(appB);
        expect(error).toBe(null);

        const pipeB = appB.renderer.renderPipes.view3d;
        expect(material._uploadQueue).toBe(pipeB.materialStoreBuffer);
        expect(material._materialIndex).toBeGreaterThanOrEqual(0);
        expect(geometry._geometryDataStore).toBe(pipeB.geometryDataStoreBuffer);
        expect(geometry._geometryDataIndex).toBeGreaterThanOrEqual(0);
        // The raw targets went at the first pack, so the morphed survivor reads
        // as unpacked (it draws its base pose, which is what weight 0 drew before).
        expect(morphed._morphDeltaBase).toBe(-1);
        expect(morphed._morphStore).toBeNull();
        expect(morphedMesh.morph!._store).toBe(pipeB._morphStoreBuffer);
        expect(morphedMesh.morph!._slot).toBeGreaterThanOrEqual(0);

        expect(differingPixels(before, pixels(appB, viewB))).toBe(0);
      } finally {
        viewA.destroy();
        appB.destroy();
      }
    });
  });
}
