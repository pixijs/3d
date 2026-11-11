import type { Buffer } from 'pixi.js';

import type { Mesh3DBatch } from '../batcher/Mesh3DBatch';
import { MESH3D_SPHERE_STRIDE } from '../buffers/Mesh3DDataStoreBuffer';
import { transformFrustumToBatch } from '../cull';
import type { CullResult } from '../render-passes/CullResult';
import type { DrawList } from '../render-passes/DrawList';
import type { ComputeSystemGpu } from './ComputeSystemGpu';

/** Planes that keep every instance; `transformFrustumToBatch` would turn their zero normals into NaN */
const ACCEPT_ALL_PLANES = new Float32Array(24);

/**
 * Smallest list whose visibility-only compaction runs on the GPU in a bundled or shadow pass; set from
 * measurements on an iPhone 15 and a Pixel 9
 * @internal
 */
export const GPU_VISIBILITY_MIN = 4000;

/**
 * A `direct` result walks on the CPU at any size, since its draws read the counts there; switching by
 * count is safe, as the count changes only with a rebuild or edit, which re-syncs the result
 * @internal
 */
export function produceVisibilityCompaction(
  compute: ComputeSystemGpu,
  list: DrawList,
  batch: Mesh3DBatch,
  boundsBuffer: Buffer,
  result: CullResult,
): void {
  if (result.lastVisibilityDirtyId === batch._visibilityDirtyId) return;
  result.lastVisibilityDirtyId = batch._visibilityDirtyId;

  if (result.direct || list.view.count < GPU_VISIBILITY_MIN) {
    produceCpuCompaction(list, batch, null, result);

    return;
  }

  compute.dispatch(
    result.indirectDrawData.drawCallsBuffer,
    list.gpuData.instanceBuffer.buffer,
    result.survivors.buffer,
    batch.storeBuffer.buffer,
    boundsBuffer,
    ACCEPT_ALL_PLANES,
    list.commandList.count,
    list.view.count,
  );
}

/**
 * Takes each command's range from the `firstInstance` lanes `CullResult.sync` copied, never from last
 * frame's counts, and keeps a sphere with a negative radius, as `transformBoundingSphere` writes for no bounds
 * @param list - The draw list to walk; never written
 * @param batch - The batch that owns the list
 * @param planes - World-space frustum planes, 24 floats, or `null` to test visibility only
 * @param result - Receives the survivors and counts
 * @internal
 */
export function produceCpuCompaction(
  list: DrawList,
  batch: Mesh3DBatch,
  planes: Float32Array | null,
  result: CullResult,
): void {
  const src = list.gpuData.instanceBuffer.data;
  const survivors = result.survivors;
  const args = result.indirectDrawData;
  const dst = survivors.data;
  const drawCalls = args.drawCalls;
  const commandCount = list.commandList.count;
  const totalInstances = list.view.count;
  const visible = batch.storeBuffer.visible;
  if (planes !== null) batch._ensureSpheres();
  const spheres = batch.storeBuffer.boundingSpheres as Float32Array;

  const frustum = planes !== null;
  const tp = frustum ? transformFrustumToBatch(planes, batch.storeBuffer.data) : ACCEPT_ALL_PLANES;

  const p0x = tp[0];
  const p0y = tp[1];
  const p0z = tp[2];
  const p0w = tp[3];
  const p1x = tp[4];
  const p1y = tp[5];
  const p1z = tp[6];
  const p1w = tp[7];
  const p2x = tp[8];
  const p2y = tp[9];
  const p2z = tp[10];
  const p2w = tp[11];
  const p3x = tp[12];
  const p3y = tp[13];
  const p3z = tp[14];
  const p3w = tp[15];
  const p4x = tp[16];
  const p4y = tp[17];
  const p4z = tp[18];
  const p4w = tp[19];
  const p5x = tp[20];
  const p5y = tp[21];
  const p5z = tp[22];
  const p5w = tp[23];

  let countsChanged = false;
  for (let k = 0; k < commandCount; k++) {
    const start = drawCalls[k * 5 + 4];
    const end = k + 1 < commandCount ? drawCalls[(k + 1) * 5 + 4] : totalInstances;
    let w = start;
    for (let i = start; i < end; i++) {
      const id = src[i];
      if (visible[id] === 0) continue;
      if (frustum) {
        const so = id * MESH3D_SPHERE_STRIDE;
        const radius = spheres[so + 3];
        if (radius >= 0) {
          const wcx = spheres[so];
          const wcy = spheres[so + 1];
          const wcz = spheres[so + 2];
          if (
            p0x * wcx + p0y * wcy + p0z * wcz + p0w < -radius ||
            p1x * wcx + p1y * wcy + p1z * wcz + p1w < -radius ||
            p2x * wcx + p2y * wcy + p2z * wcz + p2w < -radius ||
            p3x * wcx + p3y * wcy + p3z * wcz + p3w < -radius ||
            p4x * wcx + p4y * wcy + p4z * wcz + p4w < -radius ||
            p5x * wcx + p5y * wcy + p5z * wcz + p5w < -radius
          ) {
            continue;
          }
        }
      }

      dst[w++] = id;
    }
    const count = w - start;
    if (drawCalls[k * 5 + 1] !== count) {
      drawCalls[k * 5 + 1] = count;
      countsChanged = true;
    }
  }

  if (countsChanged) result.countsDirtyId++;
  survivors.upload(totalInstances);
  if (!result.direct) args.upload(commandCount);
}
