import type { Vector3 } from '../../math/vector/Vector3';
import type { Camera3D } from '../../scene/cameras/Camera3D';
import type { Mesh3DBatch } from '../batcher/Mesh3DBatch';
import type { Mesh3DData } from '../batcher/Mesh3DData';
import type { SortedMesh3DView } from '../batcher/SortedMesh3DView';
import { getCameraData } from '../CameraData';
import { resolveCullProducer } from '../cull';
import type { RenderSession } from '../render-passes/RenderSession';
import type { View3DPipeGl } from './View3DPipeGl';

/**
 * Per-batch sort hook — receives the sorted view, its owning batch, and the drawing eye
 * @internal
 */
type SortBatchFnGl = (renderables: SortedMesh3DView<Mesh3DData>, batch: Mesh3DBatch, cameraPosition: Vector3) => void;

/**
 * Options for `renderForwardBatchesGl`
 * @internal
 */
interface RenderForwardBatchesGlOptions {
  /** The WebGL backend pipe driving this render */
  pipe: View3DPipeGl;
  /** This pass's bit — indexes `batch.drawLists` */
  bit: number;
  /**
   * Camera to cull and draw from, or `null` for the view's own camera
   *
   * Supplies the frustum, the bind group bound at group 1, and the eye the distance sort
   * measures from. Culling reads {@link Camera3D#cullFrustum}.
   */
  camera: Camera3D | null;
  /** The frame's render session */
  session: RenderSession;
  /**
   * Always rebuild the command list, ignoring dirty-version and count checks
   *
   * Used by transparent (re-sorts every frame).
   */
  alwaysRebuild: boolean;
  /** Optional per-batch sort. Defaults to key-based `renderables.sort()` */
  sortBatch?: SortBatchFnGl;
  /**
   * When true, the batcher skips texture-atlas packing and the batch texture bind group
   *
   * Suitable for depth-only or solid-colour passes.
   */
  skipTextureBatching?: boolean;
}

/**
 * Shared body for forward-style WebGL passes (opaque / transparent / future custom
 * outline-style passes)
 *
 * Walks `view3d._meshBatches`, sorts via `sortBatch`, builds the instance index +
 * DrawCommandList via `batcher.build`, and replays it. The cache predicate (per-batch/pass
 * dirty version + count change) is the convention for the standard forward-pass shape;
 * transparent uses `alwaysRebuild` because it re-sorts by camera distance every frame.
 *
 * A cached command list survives a moving mesh untouched: the index it holds points at the
 * store row, and the store row is rewritten wherever the transform changes.
 *
 * Passes that need a different shape (shadow, background, copy-opaque)
 * implement `render()` themselves and don't call this helper.
 * @param options - The pass shape: pipe, pass bit, session, and cache/sort behaviour
 * @internal
 */
export function renderForwardBatchesGl(options: RenderForwardBatchesGlOptions): void {
  const { pipe, bit, session, alwaysRebuild, sortBatch, skipTextureBatching } = options;
  const { view3d } = session;
  const batcher = pipe.renderer.material3d.batcher;
  const glData = view3d._gpuData[pipe.renderer.uid];
  const camera = options.camera ?? view3d.camera;
  const cameraData = getCameraData(camera);
  const cullFrustum = camera.cullFrustum;

  // The graph binds the target and applies the camera's frame before a forward pass draws.
  cameraData.setViewport(session.activeViewport);

  for (const batch of view3d._meshBatches) {
    if (!batch.renderData._worldVisible) continue;
    const list = batch.drawLists[bit];
    if (!list) continue;
    const renderables = list.view;
    if (renderables.count === 0) continue;

    const needsRebuild = alwaysRebuild || list.isDrawStale(renderables.count);

    if (needsRebuild) {
      list.claimDrawBuilt(renderables.count);
      // Resolve the cull producer for this batch — rebuild-gated (it only changes with instance
      // count, which itself forces a rebuild). `'gpu'` degrades to `'cpu'` on WebGL.
      list._cullProducer = resolveCullProducer(view3d.cull, false, renderables.count);
      if (sortBatch) sortBatch(renderables, batch, cameraData.position);
      else renderables.sort();

      batcher.build({
        renderables,
        list: list,
        globalBindGroup: session.globalBindGroup,
        passBit: bit,
        skipTextureBatching,
      });
    }

    glData.globalUniformGroup.uniforms.uBatchWorldMatrix = batch.renderData.worldTransform;
    glData.globalUniformGroup.update();

    // Each batch owns its mesh store and each pass its index list, so both are
    // re-bound per batch. Re-reading `.texture.source` also picks up a source
    // swapped out by store growth.
    session.globalBindGroup.setResource(batch.storeBuffer.texture.source, 10);
    if (list.glData.indexTexture) session.globalBindGroup.setResource(list.glData.indexTexture.texture.source, 11);

    // draw() culls only when this batch's producer resolved to 'cpu'; otherwise the frustum is unused.
    batcher.draw(pipe.renderer, list, batch, cullFrustum, cameraData);
  }
}
