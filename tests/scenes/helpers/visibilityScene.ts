import type { TestScene } from '@test-utils';

import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import type { Mesh3D } from '~/scene/Mesh3D';
import type { CullMode } from '~/scene/View3D';
import { View3D } from '~/scene/View3D';

import { buildCubeGrid } from './cubeGrid';

interface VisibilitySceneOptions {
  /** Cull mode the view renders under. */
  cull: CullMode;
  /** `'blend'` routes the grid through the immediate transparent pass (its sort-time filter). */
  alphaMode?: 'opaque' | 'blend';
  /**
   * After the hide has rendered, remove and re-add the hidden cubes (still hidden). A re-attach
   * must behave like a first attach — the returning member needs its store row re-minted (detach
   * dropped it) or its id reaches the instance buffer as -1 and the CPU compaction draws garbage.
   */
  reattachHidden?: boolean;
}

/**
 * A 7×7 grid of cubes, all inside the camera frustum, rendered once fully and then with a
 * checkerboard subset hidden via `mesh.visible = false`. Visibility never changes pass
 * membership on either backend — hidden instances are skipped by the compaction that fills the
 * draw counts — so the hide exercises whichever producer the variant selects, with no
 * draw-command / render-bundle rebuild:
 *
 * - `cull: 'gpu'` — the compaction compute kernel (visibility-lane gate; CPU walk on WebGL);
 * - `cull: 'cpu'` — the CPU frustum compaction;
 * - `cull: 'off'` — the visibility-only walk (dirty-gated on WebGPU);
 * - `alphaMode: 'blend'` — the transparent pass, which runs the same compaction after its
 *   per-frame build.
 *
 * The initial full render matters: it bakes the draw work at the full instance count, so the
 * hide exercises the flip-after-record path, not just a hidden-from-start build. All opaque
 * variants share one reference per backend — every skip path must produce the identical
 * checkerboard.
 */
export function visibilityScene(options: VisibilitySceneOptions): TestScene {
  return {
    app: { backgroundColor: 0x101018 },
    create: async (app) => {
      const view3d = new View3D({ width: app.screen.width, height: app.screen.height, cull: options.cull });
      app.stage.addChild(view3d);

      const blend = options.alphaMode === 'blend';
      const material = new FlatMaterial({
        baseColor: 0x5b8cff,
        alphaMode: blend ? 'blend' : 'opaque',
        alpha: blend ? 0.72 : 1,
      });

      const hidden: Mesh3D[] = [];
      buildCubeGrid(view3d, material, (cube, x, y) => {
        // Checkerboard: hide every other cube after the first frame.
        if ((x + y) % 2 === 1) hidden.push(cube);
      });

      // Render the full grid so the draw work is recorded at the full instance count, then hide
      // the checkerboard — the harness's next render drives the flip-after-record path under test.
      app.render();
      for (const cube of hidden) cube.visible = false;

      if (options.reattachHidden) {
        // Consume the hide first (the flip must be processed so the detach really forgets it),
        // then bounce the hidden cubes out of and back into the scene. The final harness render
        // must still show the identical checkerboard.
        app.render();
        for (const cube of hidden) {
          view3d.root.removeChild(cube);
          view3d.root.addChild(cube);
        }
      }
    },
  };
}
