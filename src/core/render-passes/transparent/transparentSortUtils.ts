import type { Matrix4 } from '../../../math/matrix/Matrix4';
import type { Vector3 } from '../../../math/vector/Vector3';
import type { Mesh3DData } from '../../batcher/Mesh3DData';
import type { SortedMesh3DView } from '../../batcher/SortedMesh3DView';
import { MESH3D_STORE_STRIDE } from '../../buffers/Mesh3DDataStoreBuffer';

/**
 * Calculates squared camera distances and sorts meshes back-to-front for transparent blending
 *
 * After calling this, the mesh list is sorted with the furthest objects first (correct order for
 * transparent alpha blending). Visibility/frustum filtering is NOT done here — the immediate
 * passes run the same compaction as the bundled ones after building their draw data.
 * @param renderables - The pass view of transparent meshes to sort.
 * @param transformData - The store buffer's underlying Float32Array where world matrices are stored.
 * @param cameraPos - The position of the camera in world space.
 * @internal
 */
export function calculateTransparentDistances(
  renderables: SortedMesh3DView<Mesh3DData>,
  transformData: Float32Array,
  cameraPos: Vector3,
): void {
  const camX = cameraPos.x;
  const camY = cameraPos.y;
  const camZ = cameraPos.z;

  const items = renderables.items;
  const renderableIndices = renderables.renderableIndices;
  const count = renderables.count;

  for (let i = 0; i < count; i++) {
    const renderable = items[renderableIndices[i]]!;

    // The matrix is at the start of the store row. Position is at lanes 12, 13, 14.
    const matrixOffset = renderable._storeIndex * MESH3D_STORE_STRIDE;

    const dx = transformData[matrixOffset + 12] - camX;
    const dy = transformData[matrixOffset + 13] - camY;
    const dz = transformData[matrixOffset + 14] - camZ;

    const distSq = dx * dx + dy * dy + dz * dz;

    // Back-to-front (descending distance) via an ascending sort on the negated distance.
    renderable._sortKey = -distSq;
  }

  // Distance keys change every frame, so bypass the dirty check and always sort.
  renderables.sortForced((m) => m._sortKey);
}

/**
 * Distance sort for scene meshes (no batch store)
 *
 * Reads each mesh's worldMatrix translation directly. The WebGL scene-mesh path; WebGPU writes
 * every transform into the store buffer, so it only needs the store path above.
 * @param renderables - The meshes to sort back to front
 * @param cameraPos - World-space camera position
 * @internal
 */
export function calculateDistancesFromWorldMatrix(renderables: SortedMesh3DView<Mesh3DData>, cameraPos: Vector3): void {
  const camX = cameraPos.x;
  const camY = cameraPos.y;
  const camZ = cameraPos.z;

  const items = renderables.items;
  const renderableIndices = renderables.renderableIndices;
  const count = renderables.count;

  for (let i = 0; i < count; i++) {
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    const renderable = items[renderableIndices[i]]! as any;
    const e = renderable.worldTransform.elements;

    const dx = e[12] - camX;
    const dy = e[13] - camY;
    const dz = e[14] - camZ;

    renderable._sortKey = -(dx * dx + dy * dy + dz * dz);
  }

  renderables.sortForced((m) => m._sortKey);
}

/**
 * Distance sort for user-batch items
 *
 * Reads each item's local position from the store buffer and transforms it by the batch world
 * matrix. The WebGL batched path (`batch.isUserBatch`).
 * @param renderables - The batch items to sort back to front
 * @param cameraPos - World-space camera position
 * @param storeF32 - The batch's store buffer, holding each item's local matrix
 * @param batchMatrix - The batch's world matrix
 * @internal
 */
export function calculateDistancesFromStore(
  renderables: SortedMesh3DView<Mesh3DData>,
  cameraPos: Vector3,
  storeF32: Float32Array,
  batchMatrix: Matrix4,
): void {
  const camX = cameraPos.x;
  const camY = cameraPos.y;
  const camZ = cameraPos.z;
  const bm = batchMatrix.elements;

  const items = renderables.items;
  const renderableIndices = renderables.renderableIndices;
  const count = renderables.count;

  for (let i = 0; i < count; i++) {
    const renderable = items[renderableIndices[i]]!;
    const s = renderable._storeIndex * MESH3D_STORE_STRIDE;
    const tx = storeF32[s + 12];
    const ty = storeF32[s + 13];
    const tz = storeF32[s + 14];

    const wx = bm[0] * tx + bm[4] * ty + bm[8] * tz + bm[12];
    const wy = bm[1] * tx + bm[5] * ty + bm[9] * tz + bm[13];
    const wz = bm[2] * tx + bm[6] * ty + bm[10] * tz + bm[14];

    const dx = wx - camX;
    const dy = wy - camY;
    const dz = wz - camZ;

    renderable._sortKey = -(dx * dx + dy * dy + dz * dz);
  }

  renderables.sortForced((m) => m._sortKey);
}
