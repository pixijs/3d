import type { TestScene } from '@test-utils';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { Frustum } from '~/math/misc/Frustum';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import type { CullMode } from '~/scene/View3D';
import { View3D } from '~/scene/View3D';

const SIDE = 7;
const SPACING = 1.4;
const CUBE = 0.7;
const CAMERA_Z = 16;
const CULL_APEX_Z = 11;

/**
 * The {@link cullFrustumScene} grid as a single {@link BatchedMesh3D} (one user batch) under a
 * non-identity container rotation `B` — so culling runs the *user-batch* path: each instance's
 * batch-local bounding sphere is tested against the frustum moved into the batch frame by `Bᵀ`,
 * exercising the branch a scene batch's identity matrix skips (and the only end-to-end coverage of
 * `BatchedMesh3D`). The `'gpu'` and `'cpu'` variants share this builder, so their references must
 * match; on WebGL both compact on the CPU, on WebGPU `'cpu'` compacts in JS and `'gpu'` in the
 * compute kernel — all remove the same survivors.
 */
export function cullFrustumBatchedScene(cull: CullMode): TestScene {
  return {
    app: { backgroundColor: 0x101018 },
    create: async (app) => {
      const view3d = new View3D({ width: app.screen.width, height: app.screen.height, cull });
      app.stage.addChild(view3d);

      const geometry = new CubeGeometry({ width: CUBE, height: CUBE, depth: CUBE });
      const material = new FlatMaterial({ baseColor: 0x5b8cff });

      // a batch culls by its own mode, not the view's
      const batched = new BatchedMesh3D({ size: SIDE * SIDE, cull });
      const half = ((SIDE - 1) / 2) * SPACING;
      const local = new Matrix4();
      for (let x = 0; x < SIDE; x++) {
        for (let y = 0; y < SIDE; y++) {
          const i = x * SIDE + y;
          batched.setGeometryAt(i, geometry);
          batched.setMaterialAt(i, material);
          batched.setMatrixAt(i, local.makeTranslation(x * SPACING - half, y * SPACING - half, 0));
          batched.setPassesAt(i, RenderPassBit.OPAQUE);
        }
      }
      // Non-identity batch matrix `B` (container spin about Z) → the cull must transform the frustum
      // by `Bᵀ` into the batch frame, not leave it in world space.
      batched.rotation.set(0, 0, Math.PI / 5);
      view3d.root.addChild(batched);

      view3d.camera.fov = 50;
      view3d.camera.position.set(0, 0, CAMERA_Z);

      // Same detached narrow frustum as the scene-batch efficacy test: apex in front of the grid,
      // aimed straight −Z and centred, so only the central cluster survives.
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
