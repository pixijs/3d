import type { Vector3 } from '../../math/vector/Vector3';
import type { Camera3D } from '../../scene/cameras/Camera3D';
import type { Mesh3DBatch } from '../batcher/Mesh3DBatch';
import type { Mesh3DData } from '../batcher/Mesh3DData';
import type { SortedMesh3DView } from '../batcher/SortedMesh3DView';
import { getCameraData } from '../CameraData';
import { resolveCullProducer } from '../cull';
import type { RenderSession } from '../render-passes/RenderSession';
import { getGlobalGlData } from './shader/globalBitGl';
import type { View3DPipeGl } from './View3DPipeGl';

/**
 * Per-batch sort hook, given the sorted view, its owning batch, and the drawing eye
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
  /** This pass's bit, which indexes `batch.drawLists` */
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
   * When true, the batcher skips texture slot packing and the batch texture bind group
   *
   * Suitable for depth-only or solid-colour passes.
   */
  skipTextureBatching?: boolean;
}

/**
 * Shared body for forward-style WebGL passes (opaque, transparent, and any pass that draws the
 * view's meshes through `View3DPipe.renderForward`)
 *
 * Walks `view3d._meshBatches`. A batch whose draw list is stale (its dirty version or instance
 * count moved), or every batch when `alwaysRebuild` is set, is sorted and rebuilt by
 * `batcher.build`; the transparent pass rebuilds every frame because it re-sorts by camera
 * distance. A rebuild also resolves the batch's cull producer from the batch's `cull` mode and its
 * instance count, and `'gpu'` falls back to `'cpu'` on WebGL. Then each batch is drawn.
 *
 * A cached command list survives a moving mesh untouched: the index it holds points at the
 * store row, and the store row is rewritten wherever the transform changes.
 *
 * The render graph has bound the target and applied the camera's frame before this runs, so
 * `session.activeViewport` is the camera's rect. Each batch owns its mesh store and each pass its
 * index texture, so both are bound per batch, at global slots 10 and 11. Reading `.texture.source`
 * every time also picks up a texture that store growth replaced.
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
  const glData = getGlobalGlData(view3d, pipe.renderer);
  const camera = options.camera ?? view3d.camera;
  const cameraData = getCameraData(camera);
  const cullFrustum = camera.cullFrustum;

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
      list._cullProducer = resolveCullProducer(batch.cull, false, renderables.count);
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

    session.globalBindGroup.setResource(batch.storeBuffer.texture.source, 10);
    if (list.glData.indexTexture) session.globalBindGroup.setResource(list.glData.indexTexture.texture.source, 11);

    batcher.draw(pipe.renderer, list, batch, cullFrustum, cameraData);
  }
}
