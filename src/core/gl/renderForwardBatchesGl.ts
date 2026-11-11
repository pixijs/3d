import type { Vector3 } from '../../math/vector/Vector3';
import type { Camera3D } from '../../scene/cameras/Camera3D';
import type { Mesh3DBatch } from '../batcher/Mesh3DBatch';
import type { Mesh3DData } from '../batcher/Mesh3DData';
import type { SortedMesh3DView } from '../batcher/SortedMesh3DView';
import { getCameraData } from '../CameraData';
import type { RenderSession } from '../render-passes/RenderSession';
import { UINT_EMPTY } from '../textures/DefaultTextures';
import type { View3DPipeGl } from './View3DPipeGl';

type SortBatchFnGl = (renderables: SortedMesh3DView<Mesh3DData>, batch: Mesh3DBatch, cameraPosition: Vector3) => void;

interface RenderForwardBatchesGlOptions {
  pipe: View3DPipeGl;
  bit: number;
  bindsMaterial: boolean;
  camera: Camera3D | null;
  session: RenderSession;
  alwaysRebuild: boolean;
  sortBatch?: SortBatchFnGl;
}

/**
 * Binds each batch's store textures from `.texture.source` every frame, which picks up a texture that growth replaced
 * @internal
 */
export function renderForwardBatchesGl(options: RenderForwardBatchesGlOptions): void {
  const { pipe, bit, bindsMaterial, session, alwaysRebuild, sortBatch } = options;
  const { view3d } = session;
  const batcher = pipe.renderer.material3d.batcher;
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

    let build: boolean;
    if (sortBatch) {
      sortBatch(renderables, batch, cameraData.position);
      build = list.isDrawStale() || list.isOrderStale();
    } else {
      build = list.nextBuild(view3d._updateTick, alwaysRebuild);
    }

    if (build) {
      list.claimDrawBuilt();
      batcher.build({
        renderables,
        list: list,
        globalBindGroup: session.globalBindGroup,
        passBit: bit,
        bindsMaterial,
      });
    }

    session.globalBindGroup.setResource(batch.storeBuffer.texture.source, 'uMeshStoreTexture');
    if (list.glData.indexTexture) {
      session.globalBindGroup.setResource(list.glData.indexTexture.texture.source, 'uRenderInstanceTexture');
    }
    session.globalBindGroup.setResource(
      batch.instanceStoreBuffer?.texture.source ?? UINT_EMPTY.source,
      'uInstanceStoreTexture',
    );

    batcher.draw(pipe.renderer, list, batch, cullFrustum, cameraData);
  }
}
