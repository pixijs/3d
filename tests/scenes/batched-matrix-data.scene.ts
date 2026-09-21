import type { TestScene } from '@test-utils';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { View3D } from '~/scene/View3D';

const SIDE = 7;
const COUNT = SIDE * SIDE;
const SPACING = 1.4;
const CUBE = 0.7;
// Far enough along X that the camera frustum never sees it.
const PARKED_X = 200;

/**
 * A {@link BatchedMesh3D} grid placed only by writing `matrices.data` in place, under the CPU cull
 *
 * Every instance starts parked outside the frustum and is rendered there, so the cull caches an
 * out-of-view bounding sphere for each. The top rows then come in through a whole-batch
 * `matrices.update()` and the bottom rows through a partial one, with a frame between. An update that
 * failed to mark the cached spheres stale would leave its rows culled, so the full grid is only
 * drawn when both invalidation paths work. The bottom rows are tilted to tell the two apart.
 *
 * `cull: 'cpu'` is what makes this a test: the GPU cull never reads the cached spheres.
 */
export const scene: TestScene = {
  app: { backgroundColor: 0x101018 },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height, cull: 'cpu' });
    app.stage.addChild(view3d);

    const geometry = new CubeGeometry({ width: CUBE, height: CUBE, depth: CUBE });
    const upper = new FlatMaterial({ baseColor: 0x5b8cff });
    const lower = new FlatMaterial({ baseColor: 0xffb45b });
    const split = 4 * SIDE; // slots before this are the top four rows

    const batched = new BatchedMesh3D({ size: COUNT });
    for (let i = 0; i < COUNT; i++) {
      batched.setGeometryAt(i, geometry);
      batched.setMaterialAt(i, i < split ? upper : lower);
      batched.setItemActive(i, RenderPassBit.OPAQUE);
    }
    view3d.root.addChild(batched);

    view3d.camera.fov = 50;
    view3d.camera.position.set(0, 0, 14);

    const matrix = new Matrix4();
    const half = ((SIDE - 1) / 2) * SPACING;
    const place = (i: number, parked: boolean) => {
      const x = (i % SIDE) * SPACING - half;
      const y = half - Math.floor(i / SIDE) * SPACING;
      if (i < split) matrix.identity();
      else matrix.makeRotationZ(Math.PI / 4);
      matrix.elements[12] = parked ? PARKED_X : x;
      matrix.elements[13] = y;
      const { data, stride, offset } = batched.matrices;
      data.set(matrix.elements, offset + i * stride);
    };

    // 1. Everything parked out of view; the render caches each out-of-view sphere.
    for (let i = 0; i < COUNT; i++) place(i, true);
    batched.matrices.update();
    app.render();

    // 2. Whole-batch update: the top rows come in, the bottom rows stay parked.
    for (let i = 0; i < split; i++) place(i, false);
    batched.matrices.update();
    app.render();

    // 3. Partial update: the bottom rows come in.
    for (let i = split; i < COUNT; i++) place(i, false);
    batched.matrices.update(split, COUNT - split);
  },
};
