import type { Mesh3DBatch } from '../batcher/Mesh3DBatch';
import { MESH3D_LANE_VISIBILITY } from '../buffers/Mesh3DDataStoreBuffer';
import { transformFrustumToBatch } from '../cull';
import type { CullResult } from '../render-passes/CullResult';
import type { DrawList } from '../render-passes/DrawList';

// Stand-in for the hoisted plane locals on visibility-only calls; never actually tested against.
const _noPlanes = new Float32Array(24);

/**
 * CPU cull + compaction — the compute kernel's predicate, run in JS for batches where a GPU
 * dispatch isn't worth its overhead
 *
 * For each draw command it walks the command's instances (range from the stable `firstInstance`
 * lanes, so it never depends on the previous frame's rebuilt counts), skips hidden instances
 * (visibility lane), tests each survivor's cached bounding sphere against the frustum, writes
 * survivors into `result`'s survivor buffer, and rebuilds the command's `instanceCount` in
 * `result`'s args. Uploads both. (WebGL runs the same predicate in the batcher's replay,
 * compacting its interleaved records.)
 *
 * `planes: null` runs the **visibility-only** flavour: the same walk minus all frustum math. It's
 * how bundled passes with no frustum producer ('off'-resolved batches) honour `visible = false`
 * without a membership change — callers dirty-gate it on the result's `lastVisibilityDirtyId`
 * against the batch's, so it costs nothing on frames where no visibility flipped.
 *
 * The list is read, never written: every frustum drawing it — the view camera, a shadow cascade,
 * a second camera — walks the same source and fills its own {@link CullResult}, so their counts
 * stay independent. The result's args must already hold the static command lanes (index counts,
 * offsets); `CullResult.sync` copies them in on rebuild.
 *
 * One path for both batch kinds. Each instance exposes a cached bounding sphere in its batch's store
 * frame (`Mesh3DData.boundingSphere`) — world space for scene meshes, batch-local for
 * {@link BatchedMesh3D} instances. The frustum is moved into that same frame once per batch
 * (`transformFrustumToBatch`): an identity batch matrix (scene) leaves the planes in world
 * space; a user batch's `B` transforms them by `Bᵀ` and renormalizes. So the per-instance combine is
 * cached (rebuilt only when the instance moves) and a moving batch container costs 6 plane
 * transforms, not N sphere restamps.
 * @param list - The draw list to walk; read, never written
 * @param batch - The batch that owns the list; its store matrix sets the frame the planes move into
 * @param planes - World-space frustum planes (24 floats), or `null` for a visibility-only walk
 * @param result - Receives the survivors and rebuilt instance counts
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
  const items = list.view.items;
  const indices = list.view.indices;

  // Per-instance visibility lane, indexed by the same store id the kernel reads.
  const storeU32 = batch.storeBuffer.u32Data;
  const storeStride = batch.storeBuffer.stride;

  // Test planes in the batch's frame — world for scene batches, `Bᵀ`-transformed for user batches.
  // Visibility-only calls skip the transform and the per-instance sphere test below.
  const frustum = planes !== null;
  const tp = frustum ? transformFrustumToBatch(planes, batch.storeBuffer.data) : _noPlanes;

  // Six inward-facing test planes ([nx, ny, nz, c] × 6), hoisted for the inner loop.
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

  for (let k = 0; k < commandCount; k++) {
    const start = drawCalls[k * 5 + 4];
    const end = k + 1 < commandCount ? drawCalls[(k + 1) * 5 + 4] : totalInstances;
    // Write cursor into the compacted buffer (2 u32 / instance) — survivors land contiguously from
    // the command's base, so the count is `(w >> 1) - start`.
    let w = start * 2;
    for (let i = start; i < end; i++) {
      const i2 = i * 2;
      const id = src[i2];
      // Visibility (store lane, mirrors worldVisible): 0 = hidden → skip, like a frustum cull.
      if (storeU32[id * storeStride + MESH3D_LANE_VISIBILITY] === 0) continue;
      if (frustum) {
        // Cached sphere in the batch's store frame; radius < 0 = no bounds (dynamic geometry) → keep.
        const sphere = items[indices[i]].boundingSphere;
        const radius = sphere.radius;
        if (radius >= 0) {
          const center = sphere.center;
          const wcx = center.x;
          const wcy = center.y;
          const wcz = center.z;
          // Outside any plane by more than the radius → cull (skip the append). Short-circuit `||`.
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

      dst[w] = id;
      dst[w + 1] = src[i2 + 1];
      w += 2;
    }
    drawCalls[k * 5 + 1] = (w >> 1) - start;
  }

  // Record which visibility state this walk consumed — the visibility-only callers dirty-gate their
  // next run on it.
  result.lastVisibilityDirtyId = batch._visibilityDirtyId;

  survivors.upload(totalInstances);
  args.upload(commandCount);
}
