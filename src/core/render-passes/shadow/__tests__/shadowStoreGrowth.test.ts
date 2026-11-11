import { getApp, isCI, renderFrame } from '@test-utils';
import type { Application, Renderer, WebGLRenderer, WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Geometry3D } from '~/geometry/Geometry3D';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { Box } from '~/math/shapes/Box';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;

const LATE_GEOMETRIES = 128;

const LATE_WALL_COLUMNS = 600;

const WALL_WIDTH = 1.5;
const WALL_HEIGHT = 2;

const MORPH_SHIFT = 2;

const SHADOW_PIXELS = 200;

function wall(columns: number, shift: number, dynamic: boolean): Geometry3D {
  const vertexCount = (columns + 1) * 2;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const slide = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(columns * 6);

  for (let c = 0; c <= columns; c++) {
    const x = (c / columns - 0.5) * WALL_WIDTH;
    positions.set([x, 0, 0, x, WALL_HEIGHT, 0], c * 6);
    normals.set([0, 0, 1, 0, 0, 1], c * 6);
    slide[c * 6] = slide[c * 6 + 3] = shift;
  }
  for (let c = 0; c < columns; c++) {
    const v = c * 2;
    indices.set([v, v + 2, v + 3, v, v + 3, v + 1], c * 6);
  }

  return new Geometry3D({ positions, normals, indices, morphTargets: [{ positions: slide }], dynamic });
}

function addMorphedWall(view3d: View3D, x: number, columns: number, castShadow: boolean, dynamic: boolean): void {
  const mesh = new Mesh3D({
    geometry: wall(columns, -Math.sign(x) * MORPH_SHIFT, dynamic),
    material: new Material3D({ baseColor: 0x4a7c59, metallic: 0, roughness: 0.6, doubleSided: true }),
    castShadow,
    weights: new Float32Array([1]),
  });
  mesh.position.set(x, 0, 0);
  view3d.root.addChild(mesh);
}

function buildEarly(app: Application<Renderer>): { view3d: View3D; sun: DirectionalLight } {
  const view3d = new View3D({ width: SIZE, height: SIZE, shadowQuality: 'high' });
  view3d.camera.position.set(0, 6, 4);
  view3d.camera.lookAt({ x: 0, y: 0, z: -1.5 });
  app.stage.addChild(view3d);

  const sun = new DirectionalLight({
    color: 0xffffff,
    intensity: 5,
    castShadow: true,
    shadow: { bounds: Box.fromCenterSize({ x: 0, y: 0, z: 0 }, 16) },
  });
  sun.rotation.set(-0.5, 0, 0);
  view3d.root.addChild(sun);

  const ground = new Mesh3D({
    geometry: new PlaneGeometry({ width: 24, height: 24 }),
    material: new Material3D({ baseColor: 0xb0b0b0, metallic: 0, roughness: 0.95 }),
    castShadow: false,
  });
  ground.rotation.set(-Math.PI / 2, 0, 0);
  view3d.root.addChild(ground);

  addMorphedWall(view3d, -3.5, 1, true, false);

  return { view3d, sun };
}

function addLate(view3d: View3D, castShadow: boolean): void {
  const batched = new BatchedMesh3D({ size: LATE_GEOMETRIES });
  const material = new FlatMaterial({ baseColor: 0xc06c4a });
  const matrix = new Matrix4();
  for (let i = 0; i < LATE_GEOMETRIES; i++) {
    matrix.elements[12] = ((i % 32) - 15.5) * 0.2;
    matrix.elements[13] = 0.1;
    matrix.elements[14] = 1 + Math.floor(i / 32) * 0.2;
    batched.setMatrixAt(i, matrix);
    batched.setGeometryAt(i, new CubeGeometry({ width: 0.15, height: 0.15, depth: 0.15, dynamic: true }));
    batched.setMaterialAt(i, material);
    batched.setPassesAt(i, RenderPassBit.OPAQUE);
  }
  view3d.root.addChild(batched);

  addMorphedWall(view3d, 3.5, LATE_WALL_COLUMNS, castShadow, true);
}

function differingPixels(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 6) n++;
  }
  return n;
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe.skipIf(isCI)(`shadows after the shared morph and geometry stores grow (${preference})`, () => {
    for (const lateCastShadow of [true, false]) {
      it(`draws what a freshly built scene draws when the models loaded later ${lateCastShadow ? 'cast shadows' : 'cast none'}`, async () => {
        const app = await getApp<Renderer>({
          id: `shadow-store-growth-${lateCastShadow}-${preference}`,
          appOptions: { preference, width: SIZE, height: SIZE },
        });
        const reference = await getApp<Renderer>({
          id: `shadow-store-growth-reference-${lateCastShadow}-${preference}`,
          appOptions: { preference, width: SIZE, height: SIZE },
        });

        try {
          const pipe = (app.renderer as WebGLRenderer | WebGPURenderer).renderPipes.view3d;
          const { view3d } = buildEarly(app);
          app.render();
          const morphFloats = pipe._morphStoreBuffer.data.length;
          const geometryFloats = pipe.geometryDataStoreBuffer.data.length;
          const atlasVersion = pipe.atlasPool.bufferVersion;

          addLate(view3d, lateCastShadow);
          const drawn = await renderFrame(app);
          expect(pipe._morphStoreBuffer.data.length, 'the later wall outgrows the morph store').toBeGreaterThan(
            morphFloats,
          );
          expect(
            pipe.geometryDataStoreBuffer.data.length,
            'the later geometries outgrow the geometry store',
          ).toBeGreaterThan(geometryFloats);
          expect(pipe.atlasPool.bufferVersion, 'the atlas stays put, so only the stores grew').toBe(atlasVersion);

          const fresh = buildEarly(reference);
          addLate(fresh.view3d, lateCastShadow);
          const expected = await renderFrame(reference);

          fresh.sun.castShadow = false;
          const unshadowed = await renderFrame(reference);
          expect(
            differingPixels(expected, unshadowed),
            'every casting wall throws its shadow into the frame, so a wrong one shows',
          ).toBeGreaterThan(SHADOW_PIXELS * (lateCastShadow ? 2 : 1));

          expect(differingPixels(drawn, expected)).toBe(0);
        } finally {
          app.destroy();
          reference.destroy();
        }
      });
    }
  });
}
