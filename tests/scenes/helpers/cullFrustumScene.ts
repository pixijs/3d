import type { TestScene } from '@test-utils';

import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { Frustum } from '~/math/misc/Frustum';
import type { CullMode } from '~/scene/View3D';
import { View3D } from '~/scene/View3D';

import { buildCubeGrid } from './cubeGrid';

const CULL_APEX_Z = 11;

/**
 * A 7×7 grid of cubes, all inside the camera's view, culled against a *detached*
 * narrow frustum centred on the grid — so only the central cluster survives, on
 * screen. Proves a `cull` producer removes *visible* geometry deterministically
 * (efficacy), which an all-in-frustum scene cannot show. The `'gpu'` and `'cpu'`
 * variants share this builder, so their references must match — a parity guard.
 *
 * Runs on both backends: WebGPU compacts in a compute pass; WebGL compacts on the
 * CPU in the batcher's replay (and `'gpu'` degrades to that too). All three paths
 * remove the same survivors, so every reference matches.
 */
export function cullFrustumScene(cull: CullMode): TestScene {
  return {
    app: { backgroundColor: 0x101018 },
    create: async (app) => {
      const view3d = new View3D({ width: app.screen.width, height: app.screen.height, cull });
      app.stage.addChild(view3d);

      buildCubeGrid(view3d, new FlatMaterial({ baseColor: 0x5b8cff }));

      // Detached narrow frustum: apex in front of the grid, aimed straight −Z and
      // centred, so it keeps the central cubes. Pure-translation view (no lookAt).
      const proj = new Matrix4();
      proj.makePerspective((22 * Math.PI) / 180, 1, 2, 30);
      const viewMatrix = new Matrix4();
      viewMatrix.elements.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -CULL_APEX_Z, 1]);
      const vp = new Matrix4();
      vp.multiplyMatrices(proj, viewMatrix);
      view3d.camera.cullFrustum = new Frustum();
      view3d.camera.cullFrustum.setFromProjectionMatrix(vp);
    },
  };
}
